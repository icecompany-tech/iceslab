import { DELETED_USER_RETENTION_DAYS } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { redactUsername } from '../../lib/notify/telegram-notify.js';
import type { AuditTarget } from './audit.service.js';

/**
 * The objects of wave 1 as the log names them, read before the action. null:
 * there is no such object, the route answers 404 and the log keeps nothing
 * (nothing was done to anything).
 *
 * A user is named as redactUsername names it: the row outlives the user by
 * eleven months (A-268 erases at 30 days, the log keeps 365), and an erased
 * subscriber's name has no business staying behind in it.
 */
export async function userTarget(id: string): Promise<AuditTarget | null> {
  const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { username: true } });
  // The mask is a decision (ARCH 26.10), not a leftover to fix: A-268
  // promises the user erased after 30 days, and a full name kept here for
  // 365 would break that promise. The id (a uuid that says nothing about the
  // person) and the mask are enough to trace a row while the user exists.
  // The ADMIN is named in full (audit.hook.ts actorOf), this is not that.
  return u ? { kind: 'user', id, label: redactUsername(u.username) } : null;
}

/** A-268: the day the cron erases a user deleted now, and everything theirs. */
export const userErasedAfter = (now = Date.now()) =>
  new Date(now + DELETED_USER_RETENTION_DAYS * 86_400_000).toISOString();

export async function nodeTarget(id: string): Promise<AuditTarget | null> {
  const n = await prisma.node.findUnique({ where: { id }, select: { name: true } });
  return n ? { kind: 'node', id, label: n.name } : null;
}

export async function cascadeTarget(id: string): Promise<AuditTarget | null> {
  const c = await prisma.cascade.findUnique({ where: { id }, select: { name: true } });
  return c ? { kind: 'cascade', id, label: c.name } : null;
}

export async function policyTarget(id: string): Promise<AuditTarget | null> {
  const p = await prisma.nodePolicy.findUnique({ where: { id }, select: { name: true } });
  return p ? { kind: 'node_policy', id, label: p.name } : null;
}

/** A cascade's size as the log keeps it: its ways out, and every node it
 *  touches once (a node in two positions or pools is one node). */
export function cascadeCounts(c: {
  hops: { nodeId: string }[];
  positions: { nodeIds: string[] }[];
  directions: { nodeIds: string[] }[];
}): { directions: number; nodes: number } {
  const nodes = new Set<string>([
    ...c.hops.map((h) => h.nodeId),
    ...c.positions.flatMap((p) => p.nodeIds),
    ...c.directions.flatMap((d) => d.nodeIds),
  ]);
  return { directions: c.directions.length, nodes: nodes.size };
}
