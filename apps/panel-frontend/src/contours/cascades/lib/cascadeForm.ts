import type { CascadeMode, CascadeProtocol } from '@/lib/domain/cascades';
import { AMBER, CYAN, DIM, MIST, MOSS, RED, VIOLET } from '@/contours/cascades/lib/colors';

/**
 * The shape of a cascade draft and the small functions that read it.
 *
 * These live beside the components rather than inside them: both cascade pages
 * and the editor itself need them, and a file that exports components can
 * export nothing else without the dev server losing hot reload for the whole
 * module.
 */

// Mirrors the backend cap (cascade.schemas MAX_CASCADE_HOPS); keep the two in
// sync. Each hop adds latency and one more inter-hop link port to open.
export const MAX_HOPS = 5;

export const MAX_POSITIONS = MAX_HOPS;

/** Entries multiplied by directions, each pair being one link with its own
 *  credentials. Mirrors the backend ceiling. */
export const MAX_LINKS = 64;

// The seven cores a hop link can speak. Narrower than the node protocol enum on
// purpose: tuic / anytls / shadowtls exist as node protocols but not as cascade
// links.
export const LINK_PROTOCOLS: { value: CascadeProtocol; label: string }[] = [
  { value: 'xray', label: 'xray' },
  { value: 'hysteria', label: 'hysteria2' },
  { value: 'shadowsocks', label: 'shadowsocks' },
  { value: 'amneziawg', label: 'amneziawg' },
  { value: 'naive', label: 'naive' },
  { value: 'mtproto', label: 'mtproto' },
  { value: 'mieru', label: 'mieru' },
];
export const LINK_PROTOCOL_VALUES = LINK_PROTOCOLS.map((p) => p.value) as string[];

/** The hop columns are free strings in the database, and the demo seed writes
 *  `vless` there, so a stored protocol is not guaranteed to be one the API will
 *  accept back. */
export function isKnownProtocol(v: string | null | undefined): boolean {
  return Boolean(v) && LINK_PROTOCOL_VALUES.includes(v as string);
}

/** Options for a protocol field, keeping an unknown stored value visible rather
 *  than rendering an empty select over data the operator cannot see. */
export function protocolOptions(current: string | null): { value: string; label: string }[] {
  if (!current || isKnownProtocol(current)) return LINK_PROTOCOLS;
  return [...LINK_PROTOCOLS, { value: current, label: current }];
}

export type HopRole = 'entry' | 'transit' | 'exit';

export const ROLE_TONE: Record<HopRole, string> = {
  entry: CYAN,
  transit: MIST,
  exit: MOSS,
};

/** A chain is one fixed path, a balancer is a choice, and the panel colours
 *  them apart wherever a mode is named. */
export const MODE_TONE: Record<CascadeMode, string> = {
  chain: CYAN,
  balancer: VIOLET,
};

/** One hop of the draft, before it becomes a CascadeHopInput. */
export interface HopDraft {
  /** Stable across reorder and delete, so React keeps the right field focused. */
  key: number;
  nodeId: string;
  entryProtocol: CascadeProtocol;
  linkProtocol: CascadeProtocol;
}

/** entry, then in a chain the last hop is the exit; in a balancer everything
 *  past the entry is a parallel exit. */
export function roleAt(index: number, count: number, mode: CascadeMode): HopRole {
  if (index === 0) return 'entry';
  return mode === 'balancer' || index === count - 1 ? 'exit' : 'transit';
}

/** chain: every hop but the last forwards to the next. balancer: only the entry
 *  carries a link, and it is the one protocol every exit link uses. */
export function carriesLinkAt(index: number, count: number, mode: CascadeMode): boolean {
  return mode === 'balancer' ? index === 0 : index < count - 1;
}

/** The hops as the API wants them: entryProtocol only on the entry, and a link
 *  protocol only where the role actually carries one. */
export function toHopInputs(hops: HopDraft[], mode: CascadeMode) {
  return hops.map((h, i) => ({
    nodeId: h.nodeId,
    position: i,
    ...(i === 0 ? { entryProtocol: h.entryProtocol } : {}),
    ...(carriesLinkAt(i, hops.length, mode) ? { linkProtocol: h.linkProtocol } : {}),
  }));
}

/** The cascade list's status palette, so a node keeps its colour between the
 *  picker here and the card it appears on afterwards. */
export function statusTone(status: string): string {
  if (status === 'online') return MOSS;
  if (status === 'offline') return DIM;
  if (status === 'unreachable') return RED;
  return AMBER;
}

/**
 * The newer shape of the same idea. A POSITION is one step of the path and
 * holds a pool of nodes that all do the same job; a DIRECTION is a way out and
 * owns a tag for good, whatever nodes currently sit under it.
 *
 * The exit position is not a pool: it is the list of directions, which is why
 * the counter on the page adds one to the pools.
 */

export interface PositionDraft {
  key: number;
  nodeIds: string[];
  entryProtocol: CascadeProtocol;
  linkProtocol: CascadeProtocol;
}

export interface DirectionDraft {
  key: number;
  countryCode: string;
  nodeIds: string[];
  /**
   * Server identity of a direction that already exists. This is what carries
   * the tag across an edit, so it is threaded through the draft untouched and
   * sent back on save. Null means the row is new and the panel will issue it a
   * fresh tag.
   */
  id: string | null;
  /** Issued by the backend on first save, and never reused. Null while drafting. */
  tag: number | null;
}

/** Pools are the entry and whatever transits follow it; the exit is the
 *  directions block, so it is never a pool. */
export function poolRoleAt(index: number): HopRole {
  return index === 0 ? 'entry' : 'transit';
}

export function toPositionInputs(pools: PositionDraft[]) {
  return pools.map((p, i) => ({
    nodeIds: p.nodeIds.filter(Boolean),
    position: i,
    ...(i === 0 ? { entryProtocol: p.entryProtocol } : {}),
    linkProtocol: p.linkProtocol,
  }));
}

/**
 * ⚠ The `id` is the whole point of this function. A direction that goes back
 * without one is a NEW direction to the API: it gets a fresh tag, and every
 * client whose UUID carries the old tag quietly starts leaving through another
 * country. The API does fall back to matching on the node set, but that stops
 * working exactly when the pool is edited, which is the ordinary reason to open
 * this form at all.
 *
 * `tag` is deliberately not sent. The panel issues tags and never reuses them,
 * so a tag from the client could only contradict the server.
 */
export function toDirectionInputs(directions: DirectionDraft[]) {
  return directions.map((d) => ({
    ...(d.id ? { id: d.id } : {}),
    countryCode: d.countryCode,
    nodeIds: d.nodeIds.filter(Boolean),
  }));
}
