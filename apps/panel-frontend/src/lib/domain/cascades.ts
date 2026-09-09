import { api } from '@/lib/net/client';

export type CascadeProtocol =
  | 'xray' | 'hysteria' | 'amneziawg' | 'naive' | 'shadowsocks' | 'mtproto' | 'mieru';

/** 'chain' (sequential) or 'balancer' (one entry, N latency-balanced exits). */
export type CascadeMode = 'chain' | 'balancer';

export interface CascadeHop {
  id: string;
  nodeId: string;
  nodeName: string;
  position: number;
  entryProtocol: string | null;
  linkProtocol: string | null;
}

/**
 * One step of the path as the API now answers it: a POOL of interchangeable
 * nodes rather than a single machine. Position 0 is the entry.
 */
export interface CascadePosition {
  position: number;
  nodeIds: string[];
  entryProtocol: string | null;
  linkProtocol: string | null;
}

/**
 * A way out of the cascade. The identity is `id`, not the nodes behind it: the
 * pool can be swapped whole and the direction stays the same direction.
 *
 * ⚠ `tag` is the number that lives inside every client's UUID and gates squad
 * access. The panel issues it and never reuses it, so it is read-only here and
 * must NOT be sent back. What must be sent back is `id` - see
 * CascadeDirectionInput.
 */
export interface CascadeDirection {
  id: string;
  tag: number;
  countryCode: string;
  /** May legitimately be empty: the tag exists, no node stands behind it yet,
   *  and the direction is simply not handed to clients. */
  nodeIds: string[];
}

export interface Cascade {
  id: string;
  name: string;
  enabled: boolean;
  mode: CascadeMode;
  /** Hide the cascade's non-entry nodes from the raw subscription (default). */
  hideHopsFromSub: boolean;
  /** Offer the Auto line: one profile that names no direction and lets the
   *  entry pick the fastest exit by measured RTT. */
  autoProfile: boolean;
  hops: CascadeHop[];
  /** v4 shape (2026-08-04). Always present; EMPTY means the cascade predates
   *  the move and is still described by `hops`. */
  positions: CascadePosition[];
  directions: CascadeDirection[];
  /**
   * The tag the next new direction will get. Cannot be derived on this side:
   * tags are never reused, so after a direction is deleted `max(tag) + 1` names
   * a number that is already spent. Read it, never compute it.
   */
  nextDirectionTag: number;
  createdAt: string;
  updatedAt: string;
}

export interface CascadeHopInput {
  nodeId: string;
  position: number;
  entryProtocol?: CascadeProtocol;
  linkProtocol?: CascadeProtocol;
}

export interface CreateCascadeInput {
  name: string;
  enabled?: boolean;
  mode?: CascadeMode;
  hideHopsFromSub?: boolean;
  hops: CascadeHopInput[];
}

export interface UpdateCascadeInput {
  name?: string;
  enabled?: boolean;
  mode?: CascadeMode;
  hideHopsFromSub?: boolean;
  hops?: CascadeHopInput[];
}

/* ───── Cascades, v4 shape ──────────────────────────────────────────────────
 * The panel describes a cascade as positions and directions rather than hops:
 * a position is a POOL of nodes that all do the same job, and a direction is a
 * way out that owns a tag for good, whatever nodes currently sit under it.
 *
 * The API still speaks the older `hops` shape, so the write below is held
 * behind the flag until it lands. Everything above it (types, form, preview)
 * is already in the new shape, and flipping the flag is the whole migration on
 * this side.
 */

/** One step of the path. Every node in the pool does the same job in parallel. */
export interface CascadePositionInput {
  nodeIds: string[];
  position: number;
  /** Entry only: the core clients dial. */
  entryProtocol?: CascadeProtocol;
  /** What this position speaks to the next one. The exit position carries none. */
  linkProtocol?: CascadeProtocol;
}

/**
 * A way out of the cascade, on the way in.
 *
 * ⚠ `id` is what keeps the tag. Send it back for every direction that already
 * exists: a direction that arrives without one is treated as new, gets a fresh
 * tag, and everyone holding a link to the old one silently lands in another
 * country. The API does have a fallback that matches on the node set, but it
 * stops helping exactly when the pool is edited, which is the ordinary case.
 *
 * `tag` is deliberately absent: the panel issues tags and never reuses them, so
 * sending one back could only ever contradict the server.
 */
export interface CascadeDirectionInput {
  /** Omit only for a direction being created right now. */
  id?: string;
  countryCode: string;
  nodeIds: string[];
}

export interface CreateCascadeV4Input {
  name: string;
  enabled?: boolean;
  hideHopsFromSub?: boolean;
  autoProfile?: boolean;
  positions: CascadePositionInput[];
  directions: CascadeDirectionInput[];
}

/**
 * Storage moved to positions and directions on 2026-08-04, so the two shapes
 * the screens used to block, a pool of several nodes on one step and transits
 * combined with several directions, are now ordinary saves. What remains is a
 * cap on the total number of node-to-node links, which the forms still count
 * themselves because pools multiply it.
 */
export const CASCADE_V4_WRITES_LIVE = true;

export type UpdateCascadeV4Input = Partial<CreateCascadeV4Input>;

/** The API's own sentence when it refuses a shape it cannot store. */
export function cascadeShapeError(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
  if (res?.status !== 400) return null;
  return res.data?.message ?? null;
}

export async function createCascadeV4(input: CreateCascadeV4Input): Promise<Cascade> {
  const { data } = await api.post<Cascade>('/api/cascades', input);
  return data;
}

export async function updateCascadeV4(id: string, input: UpdateCascadeV4Input): Promise<Cascade> {
  const { data } = await api.put<Cascade>(`/api/cascades/${id}`, input);
  return data;
}

export async function listCascades(): Promise<{ cascades: Cascade[] }> {
  const { data } = await api.get<{ cascades: Cascade[] }>('/api/cascades');
  return data;
}

export async function createCascade(input: CreateCascadeInput): Promise<Cascade> {
  const { data } = await api.post<Cascade>('/api/cascades', input);
  return data;
}

export async function updateCascade(id: string, input: UpdateCascadeInput): Promise<Cascade> {
  const { data } = await api.put<Cascade>(`/api/cascades/${id}`, input);
  return data;
}

export interface CascadeHopStatus {
  nodeId: string;
  name: string;
  /** The node acknowledged an inbound push made after this cascade was saved. */
  applied: boolean;
  online: boolean;
}

export interface CascadeStatus {
  done: boolean;
  hops: CascadeHopStatus[];
}

/** Provisioning state of a cascade's hops, polled after a save. */
export async function getCascadeStatus(id: string): Promise<CascadeStatus> {
  const { data } = await api.get<CascadeStatus>(`/api/cascades/${id}/status`);
  return data;
}

export async function deleteCascade(id: string): Promise<void> {
  await api.delete(`/api/cascades/${id}`);
}
