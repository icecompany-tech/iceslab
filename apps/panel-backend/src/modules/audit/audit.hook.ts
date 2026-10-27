import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminAuditAction, AdminAuditOutcome } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { recordAudit, type AuditActor, type AuditEntry } from './audit.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The audit rows this request will leave, written as its answer goes
     *  out (writeAuditOnSend), with the outcome the answer carries. */
    auditEntries?: AuditEntry[];
  }
}

/**
 * Mark the request as one the log keeps. Called by the route once it knows
 * the object (its name is taken now, it may be gone afterwards), before the
 * action, so a refusal or a throw still leaves its row. The entry comes back
 * for the route to fill in its detail once the action is done.
 */
export function audit<A extends AdminAuditAction>(request: FastifyRequest, entry: AuditEntry<A>): AuditEntry<A> {
  (request.auditEntries ??= []).push(entry as AuditEntry);
  return entry;
}

async function actorOf(request: FastifyRequest): Promise<AuditActor> {
  // A token acts for the admin who issued it (null for a legacy token); the
  // label says it was a token, not that admin at the keyboard, and which one
  // by its name (ARCH 27.10: two tokens of one admin read apart; a name is not
  // a secret, the token's id stays out). Cut to the column with the rest of
  // the label in recordAudit.
  if (request.apiToken) {
    return { kind: 'api_token', id: request.admin?.id ?? null, label: `api token: ${request.apiToken.name}` };
  }
  // The admin by full name, as of the action (ARCH 26.10): the log is read
  // only in an admin session, and its point is who exactly; a mask cannot
  // tell two similar logins apart. The mask stays where text leaves the
  // panel (Telegram).
  if (request.admin) {
    const admin = await prisma.adminUser.findUnique({ where: { id: request.admin.id }, select: { username: true } });
    return { kind: 'admin', id: request.admin.id, label: admin?.username ?? 'deleted admin' };
  }
  return { kind: 'system', id: null, label: 'system' };
}

const outcomeOf = (status: number): AdminAuditOutcome => (status < 400 ? 'ok' : status < 500 ? 'refused' : 'failed');

/** The code of a refusal (`error` of the body), never its message. */
function refusalOf(payload: unknown): string | null {
  if (typeof payload !== 'string') return null;
  try {
    const code = (JSON.parse(payload) as { error?: unknown }).error;
    return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * Global onSend: write the request's audit rows before its answer leaves, so
 * the outcome is the one the caller sees (an error handler's 500 included).
 * Best effort: a failed write is logged and the answer goes out as it was.
 */
export async function writeAuditOnSend(request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
  const entries = request.auditEntries;
  if (!entries?.length) return payload;
  request.auditEntries = undefined;
  const outcome = outcomeOf(reply.statusCode);
  try {
    await recordAudit(await actorOf(request), entries, outcome, outcome === 'refused' ? refusalOf(payload) : null);
  } catch (err) {
    request.log.error({ err, actions: entries.map((e) => e.action) }, '[audit] row not written, the action stands');
  }
  return payload;
}

/** onRequest after requireAuth: the log is read in a session, not by a token. */
export async function refuseApiToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.apiToken) {
    return reply.code(403).send({ error: 'AUDIT_ADMIN_ONLY', message: 'The audit log is read by an admin session, not by an API token' });
  }
}
