/**
 * The admin audit log (after v0.3.0-rc.1, decisions 26.10): who did what to
 * which object, when, and how it ended. One contract for the panel that
 * writes it and the screen that reads it (GET /api/audit).
 *
 * What it never carries: tokens, keys, passwords, request bodies, core
 * configs, IP addresses (A-267). The detail of an action is a short summary
 * by a list of fields per action, checked by the server before it is written.
 */

/** Days an audit row is kept (RETENTION_DAYS.adminAudit). */
export const ADMIN_AUDIT_RETENTION_DAYS = 365;

/** Wave 1, decisions 26.10. */
export const ADMIN_AUDIT_ACTIONS = [
  'user.delete',
  'node.connLog.clear',
  'node.cert.rotate',
  'cascade.create',
  'cascade.update',
  'cascade.delete',
  'cascade.enable',
  'cascade.disable',
  'nodePolicy.create',
  'nodePolicy.update',
  'nodePolicy.delete',
  'nodePolicy.attach',
  'nodePolicy.detach',
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const ADMIN_AUDIT_TARGET_KINDS = ['user', 'node', 'cascade', 'node_policy'] as const;
export type AdminAuditTargetKind = (typeof ADMIN_AUDIT_TARGET_KINDS)[number];

export type AdminAuditActorKind = 'admin' | 'api_token' | 'system';
export type AdminAuditOutcome = 'ok' | 'refused' | 'failed';

/** What each action keeps as its detail. A refused or failed action keeps
 *  only what was known before it: the policy of an attach, nothing (null) for
 *  the rest, since their summary is of what was done. */
export interface AdminAuditDetails {
  'user.delete': { erasedAfter: string };
  'node.connLog.clear': { outcome: { source: 'journal' | 'syslog'; state: 'cleared' | 'absent' | 'failed' }[] };
  'node.cert.rotate': { notAfter: string };
  /** The cascade after the action; for delete, before it. */
  'cascade.create': { directions: number; nodes: number };
  'cascade.update': { directions: number; nodes: number };
  'cascade.delete': { directions: number; nodes: number };
  'cascade.enable': { directions: number; nodes: number };
  'cascade.disable': { directions: number; nodes: number };
  'nodePolicy.create': { rules: number; nodes: number };
  'nodePolicy.update': { rules: number; nodes: number };
  'nodePolicy.delete': { rules: number; nodes: number };
  'nodePolicy.attach': { policyId: string; policyLabel: string };
  'nodePolicy.detach': { policyId: string; policyLabel: string };
}

/** One row of GET /api/audit. */
export interface AdminAuditEventDto {
  /** BIGSERIAL as a string, so JSON keeps it whole. */
  id: string;
  at: string;
  actor: { kind: AdminAuditActorKind; id: string | null; label: string };
  action: AdminAuditAction;
  /** label is the name at the time of the action; the object may be gone. */
  target: { kind: AdminAuditTargetKind; id: string | null; label: string };
  outcome: AdminAuditOutcome;
  /** On refused only: the route's refusal code, never its message. */
  refusal: string | null;
  detail: AdminAuditDetails[AdminAuditAction] | null;
}

export interface AdminAuditListResponse {
  events: AdminAuditEventDto[];
  /** null when there is no further page. */
  nextCursor: string | null;
}
