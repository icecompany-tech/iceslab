import type { LingeringUser } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { redis } from '../../lib/infra/redis.js';

/**
 * A-218: users taken off a node whose xray connections are still open.
 *
 * xray's `rmu` takes a user off an inbound and leaves the connections they
 * had open running until the client closes them; restarting the core to cut
 * them would cut everybody (P6). So the operator is shown them instead. The
 * agent reads xray's online map on every stats poll and names the users the
 * core no longer holds; this keeps the last answer per node.
 *
 * Current state, not history: a Redis key per node that lives three polls
 * (node-stats-poll runs every 30 s). A node whose agent did not say (older
 * agent, no xray, the online query failed) gets no key, and reading it gives
 * null: "not checked", never "nobody".
 *
 * xray counts by email, not by inbound: a user taken off one inbound and kept
 * on another is not here. And only xray: the other cores take a user off by a
 * restart, which cuts the session by itself. Addresses are never kept.
 */

const POLL_SECONDS = 30;
const TTL_SECONDS = POLL_SECONDS * 3;
const keyOf = (nodeId: string) => `node:lingering:${nodeId}`;

interface Stored {
  observedAt: string;
  users: LingeringUser[];
}

/** After a poll: the agent's answer as it is, or nothing when it did not say. */
export async function storeLingering(nodeId: string, lingering: LingeringUser[] | undefined, now = new Date()): Promise<void> {
  if (lingering === undefined) return;
  const value: Stored = {
    observedAt: now.toISOString(),
    users: lingering.filter((l) => typeof l.email === 'string' && l.email !== '' && l.sessions > 0),
  };
  await redis.set(keyOf(nodeId), JSON.stringify(value), 'EX', TTL_SECONDS);
}

async function readStored(nodeIds: string[]): Promise<Map<string, Stored>> {
  const out = new Map<string, Stored>();
  if (nodeIds.length === 0) return out;
  const raw = await redis.mget(...nodeIds.map(keyOf));
  raw.forEach((v, i) => {
    if (!v) return;
    try {
      out.set(nodeIds[i]!, JSON.parse(v) as Stored);
    } catch {
      // A value nobody can read is no fact.
    }
  });
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UserRow = { id: string; username: string; status: string };

/**
 * The email xray knows a user by is their id (vless, vmess, trojan) or the
 * login of a socks/http door, which is the username. Ids first; a username
 * is taken from a live user before a deleted one.
 */
async function usersOf(emails: string[]): Promise<Map<string, UserRow>> {
  const ids = emails.filter((e) => UUID.test(e));
  const names = emails.filter((e) => !UUID.test(e));
  const [byId, byName] = await Promise.all([
    ids.length > 0
      ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, status: true } })
      : [],
    names.length > 0
      ? prisma.user.findMany({
          where: { username: { in: names } },
          select: { id: true, username: true, status: true },
          // Live users first, then the newest: the first row per name wins.
          orderBy: [{ deletedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
        })
      : [],
  ]);
  const out = new Map<string, UserRow>();
  for (const u of byId) out.set(u.id, u);
  for (const u of byName) if (!out.has(u.username)) out.set(u.username, u);
  return out;
}

export type NodeLingering = {
  observedAt: string;
  users: {
    userId: string | null;
    username: string | null;
    status: 'active' | 'disabled' | 'expired' | 'limited' | null;
    sessions: number;
  }[];
} | null;

const STATUSES = ['active', 'disabled', 'expired', 'limited'] as const;
const statusOf = (s: string | undefined): NonNullable<NodeLingering>['users'][number]['status'] =>
  (STATUSES as readonly string[]).includes(s ?? '') ? (s as NonNullable<NodeLingering>['users'][number]['status']) : null;

/** GET /api/nodes/:id: who lingers on this node, or null when not checked. */
export async function nodeLingering(nodeId: string): Promise<NodeLingering> {
  const stored = (await readStored([nodeId])).get(nodeId);
  if (!stored) return null;
  const users = await usersOf(stored.users.map((l) => l.email));
  return {
    observedAt: stored.observedAt,
    users: stored.users.map((l) => {
      const u = users.get(l.email);
      return { userId: u?.id ?? null, username: u?.username ?? null, status: statusOf(u?.status), sessions: l.sessions };
    }),
  };
}

export type LiveAfterRemoval = { nodeId: string; nodeName: string; sessions: number; observedAt: string }[];

/** GET /api/users/:id: the nodes this user still holds a connection on after being taken off. */
export async function userLiveAfterRemoval(user: { id: string; username: string }): Promise<LiveAfterRemoval> {
  const nodes = await prisma.node.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
  const stored = await readStored(nodes.map((n) => n.id));
  const out: LiveAfterRemoval = [];
  for (const n of nodes) {
    const s = stored.get(n.id);
    if (!s) continue;
    const sessions = s.users
      .filter((l) => l.email === user.id || l.email === user.username)
      .reduce((acc, l) => acc + l.sessions, 0);
    if (sessions > 0) out.push({ nodeId: n.id, nodeName: n.name, sessions, observedAt: s.observedAt });
  }
  return out;
}
