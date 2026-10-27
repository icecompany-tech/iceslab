import { api } from '@/lib/net/client';

/**
 * A-218: users taken off a node whose xray connections are still open.
 *
 * xray's `rmu` takes a user off an inbound and leaves the connections they
 * had open running until the client closes them; a core restart would cut
 * them, and everyone else with them. So the panel only shows who still holds
 * one (stats/lingering.ts on the server, a key per node that lives three
 * polls).
 *
 * Both answers ride on the single-object GETs. Every answer is checked
 * first: a malformed one is `null`, never «nobody».
 */

/** GET /api/nodes/:id, read for its `lingering`. */
export async function getNodeWithLingering(nodeId: string): Promise<unknown> {
  const { data } = await api.get<unknown>(`/api/nodes/${nodeId}`);
  return data;
}

/** GET /api/users/:id, read for its `liveAfterRemoval`. */
export async function getUserWithLiveAfterRemoval(userId: string): Promise<unknown> {
  const { data } = await api.get<unknown>(`/api/users/${userId}`);
  return data;
}

export interface LingeringRow {
  /** null: the email the core named matches no user (a login of a removed door). */
  userId: string | null;
  username: string | null;
  /** The user's status as stored; null when unknown. Kept as the server's word. */
  status: string | null;
  sessions: number;
}

/**
 *   old-server  the answer has no `lingering` key: a panel older than A-218;
 *   unchecked   null: the agent did not say (older agent, no xray, the online
 *               query failed, or no poll in the last three). Not «nobody»;
 *   known       the last poll's answer; an empty list is «nobody».
 */
export type NodeLingering =
  | { kind: 'old-server' }
  | { kind: 'unchecked' }
  | { kind: 'known'; observedAt: string; users: LingeringRow[] };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const sessionsOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

export function nodeLingeringOf(data: unknown): NodeLingering | null {
  const d = obj(data);
  if (!d) return null;
  if (!('lingering' in d)) return { kind: 'old-server' };
  if (d.lingering === null) return { kind: 'unchecked' };
  const l = obj(d.lingering);
  if (!l || typeof l.observedAt !== 'string' || !Array.isArray(l.users)) return null;
  const users: LingeringRow[] = [];
  for (const x of l.users) {
    const u = obj(x);
    if (!u || !strOrNull(u.userId) || !strOrNull(u.username) || !strOrNull(u.status) || !sessionsOk(u.sessions)) return null;
    users.push({ userId: u.userId, username: u.username, status: u.status, sessions: u.sessions });
  }
  // Most connections first; a name settles a tie so the list does not jump between polls.
  users.sort((a, b) => b.sessions - a.sessions || (a.username ?? '').localeCompare(b.username ?? ''));
  return { kind: 'known', observedAt: l.observedAt, users };
}

export interface LiveAfterRemovalRow {
  nodeId: string;
  nodeName: string;
  sessions: number;
  observedAt: string;
}

/**
 * The nodes this user, taken off, still holds a connection on. The server
 * lists only nodes that answered, so an empty list is not «nowhere»: a node
 * not checked is simply absent. The screen therefore says only the «yes».
 * `null`: an older server (no key) or a malformed answer.
 */
export function liveAfterRemovalOf(data: unknown): LiveAfterRemovalRow[] | null {
  const d = obj(data);
  if (!d || !Array.isArray(d.liveAfterRemoval)) return null;
  const rows: LiveAfterRemovalRow[] = [];
  for (const x of d.liveAfterRemoval) {
    const r = obj(x);
    if (!r || typeof r.nodeId !== 'string' || typeof r.nodeName !== 'string') return null;
    if (!sessionsOk(r.sessions) || typeof r.observedAt !== 'string') return null;
    rows.push({ nodeId: r.nodeId, nodeName: r.nodeName, sessions: r.sessions, observedAt: r.observedAt });
  }
  return rows;
}
