import type { EngineName } from '@iceslab/shared';
import { api } from '@/lib/net/client';
import type { ProtocolName } from '@/lib/domain/protocols';
import type { InboundConfig } from '@/lib/domain/inbounds';

// Replaces the per-node Inbound model. A Profile is a logical inbound
// template (shared across nodes), a Binding deploys it to a specific node
// with optional per-node overrides.

/**
 * The three engines a profile may PIN, which is a narrower thing than the
 * engines a node can run: the other four cores serve exactly one protocol, so
 * pinning them would say nothing the protocol has not already said.
 *
 * Named apart from the contract's `EngineName` on purpose. A shorter union
 * under the same name in a second file is the trap from CLAUDE.local.md, one
 * name and two forms of value, and `effectiveEngine` below is the full one.
 */
export type PinnableEngine = 'xray' | 'hysteria' | 'singbox';

export interface Profile {
  id: string;
  name: string;
  protocol: ProtocolName;
  /** Proxy core that serves this profile. null = native core; 'singbox' = the
   *  sing-box engine (engine-choice). This is the STORED value, the one the
   *  form edits. */
  engine: string | null;
  /**
   * The core that will actually render it: the pinned one, or the protocol's
   * native core. Never null.
   *
   * Resolved on the server on purpose. The protocol-to-native-core table lives
   * in the agent and once in the panel; a third copy in the browser would drift
   * from both without a sound, so nothing here re-derives it.
   */
  effectiveEngine: EngineName;
  description: string | null;
  config: InboundConfig;
  enabled: boolean;
  bindingCount: number;
  /** Distinct users who can reach this profile via squad ACL. */
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Binding {
  id: string;
  profileId: string;
  nodeId: string;
  port: number;
  publicHost: string | null;
  publicPort: number | null;
  overrides: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileInput {
  name: string;
  protocol: ProtocolName;
  description?: string | null;
  /** Engine-choice: null/omitted = native core, 'singbox' = sing-box. */
  engine?: PinnableEngine | null;
  config: InboundConfig;
  enabled?: boolean;
}

export interface UpdateProfileInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  engine?: PinnableEngine | null;
  config?: InboundConfig;
}

export interface CreateBindingInput {
  profileId: string;
  nodeId: string;
  port: number;
  publicHost?: string;
  publicPort?: number;
  overrides?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateBindingInput {
  port?: number;
  publicHost?: string | null;
  publicPort?: number | null;
  overrides?: Record<string, unknown> | null;
  enabled?: boolean;
}

export async function listProfiles(params?: {
  protocol?: ProtocolName;
}): Promise<{ profiles: Profile[] }> {
  const { data } = await api.get<{ profiles: Profile[] }>('/api/profiles', { params });
  return data;
}

/**
 * Which Host columns mean anything for a given profile, and what each inherits
 * when the host leaves it NULL.
 *
 * The set depends on the profile's CONFIG, not just its protocol: path and Host
 * exist only on an HTTP-ish transport, a fingerprint only where the client
 * speaks TLS. Outside xray almost nothing applies, so the form asks rather than
 * guessing.
 */
export interface HostFieldSupport {
  supported: boolean;
  /** Profile-level default. Null means there is nothing to inherit, either
   *  because the adapter decides or because the value is per node. */
  inherited?: string | string[] | null;
  /** Written for an operator, so it can be shown verbatim. */
  reason?: string;
}

export type HostFieldMap = Record<string, HostFieldSupport>;

export async function getProfileHostFields(id: string): Promise<{ fields: HostFieldMap }> {
  const { data } = await api.get<{ fields: HostFieldMap }>(`/api/profiles/${id}/host-fields`);
  return data;
}

/** A host whose SNI the profile's node would not serve. `expected` carries the
 *  names it does serve, so the form can name them instead of just refusing. */
export function sniMismatch(err: unknown): string[] | null {
  const body = (err as { response?: { data?: { error?: string; expected?: unknown } } }).response?.data;
  if (body?.error !== 'SNI_MISMATCH') return null;
  return Array.isArray(body.expected) ? body.expected.filter((x): x is string => typeof x === 'string') : [];
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const { data } = await api.post<Profile>('/api/profiles', input);
  return data;
}

export async function updateProfile(id: string, input: UpdateProfileInput): Promise<Profile> {
  const { data } = await api.put<Profile>(`/api/profiles/${id}`, input);
  return data;
}

export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`/api/profiles/${id}`);
}

export async function listBindings(params?: {
  nodeId?: string;
  profileId?: string;
}): Promise<{ bindings: Binding[] }> {
  const { data } = await api.get<{ bindings: Binding[] }>('/api/bindings', { params });
  return data;
}

export async function createBinding(input: CreateBindingInput): Promise<Binding> {
  const { data } = await api.post<Binding>('/api/bindings', input);
  return data;
}

/** F-P1-b: next free listen port for a new binding on `nodeId` (skips ports
 *  already bound there). Pre-fills the deploy modal so it stops defaulting to
 *  443 and 409-ing on multi-protocol nodes. */
export async function getNextFreePort(nodeId: string): Promise<number> {
  const { data } = await api.get<{ port: number }>('/api/bindings/next-free-port', {
    params: { nodeId },
  });
  return data.port;
}

export async function updateBinding(id: string, input: UpdateBindingInput): Promise<Binding> {
  const { data } = await api.put<Binding>(`/api/bindings/${id}`, input);
  return data;
}

export async function deleteBinding(id: string): Promise<void> {
  await api.delete(`/api/bindings/${id}`);
}

// ───── Test-Connect (slice 31) ─────

export interface TestConnectResult {
  bindingId: string;
  hostId: string | null;
  hostRemark: string;
  protocol: string;
  nodeName: string;
  endpoint: string;
  port: number;
  probe: 'tcp' | 'tls' | 'skip';
  // K10: 'endpoint' = client-facing target; 'dest' = the REALITY masquerade
  // target the node borrows its TLS1.3 handshake from.
  kind: 'endpoint' | 'dest';
  sni?: string;
  ok: boolean;
  latencyMs?: number;
  certCn?: string;
  // TLS-only: negotiated version. REALITY needs the dest to speak TLSv1.3.
  tlsVersion?: string;
  // H1 (dest) - negotiated ALPN (e.g. "h2"); a CDN-grade dest speaks HTTP/2.
  alpn?: string;
  error?: string;
  notes?: string;
}

export async function testConnectProfile(profileId: string): Promise<{ results: TestConnectResult[] }> {
  const { data } = await api.post<{ results: TestConnectResult[] }>(
    `/api/profiles/${profileId}/test-connect`,
  );
  return data;
}
