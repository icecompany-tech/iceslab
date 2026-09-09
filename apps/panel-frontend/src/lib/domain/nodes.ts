import { api } from '@/lib/net/client';

export type NodeProtocol =
  | 'xray'
  | 'hysteria'
  | 'amneziawg'
  | 'naive'
  | 'shadowsocks'
  | 'mtproto'
  | 'mieru'
  | 'tuic'
  | 'anytls'
  | 'shadowtls';

// G (Zashchita / hardening) - probe-resistance toggles persisted to
// nodes.hardening. Each maps 1:1 to an install-iceslab-node.sh flag. NULL on a
// node = no hardening (install command is unchanged).
export interface NodeHardening {
  ufwLockdown?: boolean;
  fail2ban?: boolean;
  realisticFallback?: boolean;
  sshAllowlist?: string[];
}

/**
 * How often the node's xray core came back up, and how close it runs to the
 * ceiling that makes the agent restart it (2026-08-04).
 *
 * A restart drops every live connection, so this is the one number that turns
 * "users complain, panel is green" into something an operator can see.
 *
 * ⚠ The whole object is null on a node that never reported it - a pre-2026-08
 * agent, or one that has not checked in yet. That is NOT the same as zero
 * restarts, and the card must not print it as one. Same rule one level down:
 * `memoryLimitBytes` absent means the watchdog is off, not that it is zero.
 */
export interface CoreRestarts {
  /** crash + memory. */
  total: number;
  /** Core died on its own - growth here is a bug to chase, not maintenance. */
  crash: number;
  /** Watchdog acted before the kernel would have. */
  memory: number;
  /** Absent until something has actually restarted. */
  lastAt?: string;
  /** `crash` | `memory` - kept as a plain string, the panel treats anything
   *  that is not `memory` as a crash rather than rejecting it. */
  lastReason?: string;
  /** Armed ceiling in bytes; absent = watchdog off on that node. */
  memoryLimitBytes?: number;
  /** Latest resident-size sample of the core process. */
  rssBytes?: number;
  /**
   * When the panel last WROTE this tally, not when it last polled the node.
   * The status cron ticks every 30s but only persists when a counter moved or
   * RSS drifted >10%, so a steady core legitimately carries an old stamp. Show
   * it as a fact, never colour it as staleness - see NodeCard.
   */
  observedAt: string;
}

export interface Node {
  id: string;
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  /** See CoreRestarts. null = never reported, not zero. */
  coreRestarts: CoreRestarts | null;
  // T7 - proxy-core version (e.g. xray "26.3.27"), null until a versioned agent
  // reports in. Shown on the node card; cascade form warns on an old balancer entry.
  coreVersion: string | null;
  consumptionMultiplier: string;
  // Slice 27.5
  regionId: string | null;
  maxUsers: number | null;
  // B3/G - FQDN for REALITY self-steal serverName + future ACME.
  domain: string | null;
  // G - Zashchita hardening blob.
  hardening?: NodeHardening | null;
  // WARP egress on/off (per-node). Creds are never sent to the client.
  warpEnabled: boolean;
  // Engine-choice: sing-box engine installed alongside the native core.
  singboxEngine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  nodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapInfo {
  /** Single-use token (URL-safe, ~32 chars). Survives the 4 KB TTY paste limit. */
  token: string;
  /** ISO timestamp when the token stops being redeemable. */
  expiresAt: string;
  /** Pre-rendered single-line install command, ready to copy-paste on the node. */
  command: string;
}

/** The create response carries the one-time payload + a bootstrap token. */
export interface NodeWithPayload extends Node {
  payload: string;
  bootstrap: BootstrapInfo;
}

/**
 * Register a free Cloudflare WARP device for this node and enable per-node WARP
 * egress (the node's xray inbound starts routing out through WARP on next push).
 * The Cloudflare call happens server-side; creds stay in the panel DB.
 */
export async function registerNodeWarp(id: string): Promise<Node> {
  const { data } = await api.post<Node>(`/api/nodes/${id}/warp/register`);
  return data;
}

/** Turn off WARP egress for this node (keeps creds for instant re-enable). */
export async function disableNodeWarp(id: string): Promise<Node> {
  const { data } = await api.delete<Node>(`/api/nodes/${id}/warp`);
  return data;
}

export async function refreshNodeBootstrap(id: string): Promise<BootstrapInfo> {
  const { data } = await api.post<BootstrapInfo>(`/api/nodes/${id}/bootstrap`);
  return data;
}

export interface NodesListResponse {
  nodes: Node[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateNodeInput {
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
  regionId?: string | null;
  maxUsers?: number | null;
  domain?: string | null;
  hardening?: NodeHardening | null;
  singboxEngine?: boolean;
}

export interface UpdateNodeInput {
  name?: string;
  address?: string;
  protocol?: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
  regionId?: string | null;
  maxUsers?: number | null;
  domain?: string | null;
  hardening?: NodeHardening | null;
  singboxEngine?: boolean;
}

export async function listNodes(params?: {
  page?: number;
  limit?: number;
  status?: string;
  regionId?: string;
}): Promise<NodesListResponse> {
  const { data } = await api.get<NodesListResponse>('/api/nodes', { params });
  return data;
}

/** Largest page the list endpoint accepts; asking for more is a 400. */
const NODES_PAGE_MAX = 100;

/**
 * One node by id. There is no single-node GET, so this walks the list a page
 * at a time and stops at the first match. Cheap for any fleet that fits one
 * page, and correct for the ones that do not.
 */
export async function findNode(id: string): Promise<Node | null> {
  for (let page = 1; ; page++) {
    const res = await listNodes({ page, limit: NODES_PAGE_MAX });
    const hit = res.nodes.find((n) => n.id === id);
    if (hit) return hit;
    if (page * NODES_PAGE_MAX >= res.total || res.nodes.length === 0) return null;
  }
}

// ───── Regions (slice 27.5) ─────

export async function listRegions(): Promise<{ regions: Region[] }> {
  const { data } = await api.get<{ regions: Region[] }>('/api/regions');
  return data;
}

export async function createRegion(input: { name: string; code: string }): Promise<Region> {
  const { data } = await api.post<Region>('/api/regions', input);
  return data;
}

export async function updateRegion(
  id: string,
  input: { name?: string; code?: string },
): Promise<Region> {
  const { data } = await api.put<Region>(`/api/regions/${id}`, input);
  return data;
}

export async function deleteRegion(id: string): Promise<void> {
  await api.delete(`/api/regions/${id}`);
}

export async function createNode(input: CreateNodeInput): Promise<NodeWithPayload> {
  const { data } = await api.post<NodeWithPayload>('/api/nodes', input);
  return data;
}

export async function updateNode(id: string, input: UpdateNodeInput): Promise<Node> {
  const { data } = await api.put<Node>(`/api/nodes/${id}`, input);
  return data;
}

export async function deleteNode(id: string): Promise<void> {
  await api.delete(`/api/nodes/${id}`);
}

// ───── G4: node probe-exposure ─────

export interface PortExposureResult {
  /** false when the check could not run (ufw-less host, old/unreachable agent). */
  checked: boolean;
  managed?: boolean;
  expected?: string[];
  extras?: string[];
  note?: string;
}

export async function getNodeExposure(id: string): Promise<PortExposureResult> {
  const { data } = await api.get<PortExposureResult>(`/api/nodes/${id}/exposure`);
  return data;
}
