import type {
  AdminAuditAction,
  AdminAuditActorKind,
  AdminAuditDetails,
  AdminAuditEventDto,
  AdminAuditListResponse,
  AdminAuditOutcome,
  AdminAuditTargetKind,
} from '@iceslab/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { getLogger } from '../../lib/infra/logger.js';
import { checkDetail } from './audit.details.js';
import type { AuditListQuery } from './audit.schemas.js';

export interface AuditActor {
  kind: AdminAuditActorKind;
  id: string | null;
  label: string;
}

export interface AuditTarget {
  kind: AdminAuditTargetKind;
  id: string | null;
  /** The object's name now, before the action: it may be gone after it. */
  label: string;
}

export interface AuditEntry<A extends AdminAuditAction = AdminAuditAction> {
  action: A;
  target: AuditTarget;
  detail?: AdminAuditDetails[A] | null;
}

// The columns' widths (audit.prisma): a longer name is cut, not refused.
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * Write the rows of one request. The action has already happened, so nothing
 * here may turn it into an error: a detail that does not fit its schema is
 * dropped with a warning, and the caller catches a failed insert.
 *
 * `at` is set here, not by the column default: now() keeps microseconds, a JS
 * Date keeps milliseconds, and a cursor read back from a row would then never
 * equal the row it came from (the page boundary would skip or repeat rows).
 */
export async function recordAudit(
  actor: AuditActor,
  entries: readonly AuditEntry[],
  outcome: AdminAuditOutcome,
  refusal: string | null,
): Promise<void> {
  if (entries.length === 0) return;
  const at = new Date();
  const data = entries.map((e) => {
    const { detail, dropped } = checkDetail(e.action, e.detail);
    if (dropped) {
      getLogger().warn({ event: 'audit.detail.dropped', action: e.action, reason: dropped }, '[audit] detail does not fit its action, row kept without it');
    }
    return {
      at,
      actorKind: actor.kind,
      actorId: actor.id,
      actorLabel: cut(actor.label, 64),
      action: e.action,
      targetKind: e.target.kind,
      targetId: e.target.id,
      targetLabel: cut(e.target.label, 128),
      outcome,
      refusal: outcome === 'refused' && refusal ? cut(refusal, 64) : null,
      detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  });
  await prisma.adminAuditEvent.createMany({ data });
}

export class BadCursorError extends Error {
  readonly code = 'BAD_CURSOR';
  constructor() {
    super('The cursor is not one this list handed out');
    this.name = 'BadCursorError';
  }
}

/** Opaque to the screen: the (at, id) of the last row of the page. */
export function encodeCursor(at: Date, id: bigint): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id.toString()])).toString('base64url');
}

export function decodeCursor(cursor: string): { at: Date; id: bigint } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && /^\d{1,19}$/.test(v[1])) {
      const at = new Date(v[0]);
      if (!Number.isNaN(at.getTime()) && at.toISOString() === v[0]) return { at, id: BigInt(v[1]) };
    }
  } catch {
    // falls through to the refusal
  }
  throw new BadCursorError();
}

type Row = Prisma.AdminAuditEventGetPayload<object>;

function mapEvent(r: Row): AdminAuditEventDto {
  return {
    id: r.id.toString(),
    at: r.at.toISOString(),
    actor: { kind: r.actorKind as AdminAuditActorKind, id: r.actorId, label: r.actorLabel },
    action: r.action as AdminAuditAction,
    target: { kind: r.targetKind as AdminAuditTargetKind, id: r.targetId, label: r.targetLabel },
    outcome: r.outcome as AdminAuditOutcome,
    refusal: r.refusal,
    detail: (r.detail ?? null) as AdminAuditEventDto['detail'],
  };
}

/** Newest first, (at, id) descending, one page past the cursor. */
export async function listAudit(q: AuditListQuery): Promise<AdminAuditListResponse> {
  const and: Prisma.AdminAuditEventWhereInput[] = [];
  if (q.action) and.push(q.action.endsWith('.') ? { action: { startsWith: q.action } } : { action: q.action });
  if (q.targetKind) and.push({ targetKind: q.targetKind });
  if (q.targetId) and.push({ targetId: q.targetId });
  if (q.actorId) and.push({ actorId: q.actorId });
  if (q.from) and.push({ at: { gte: new Date(q.from) } });
  if (q.to) and.push({ at: { lt: new Date(q.to) } });
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    and.push({ OR: [{ at: { lt: c.at } }, { at: c.at, id: { lt: c.id } }] });
  }
  const rows = await prisma.adminAuditEvent.findMany({
    where: { AND: and },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    events: page.map(mapEvent),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.at, last.id) : null,
  };
}
