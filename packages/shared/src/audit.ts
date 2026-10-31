/**
 * The admin audit log (after v0.3.0-rc.1, decisions 26.10): who did what to
 * which object, when, and how it ended. One contract for the panel that
 * writes it and the screen that reads it (GET /api/audit).
 *
 * What it never carries: tokens, keys, passwords, request bodies, core
 * configs, IP addresses (A-267). A sign-in keeps the network it came from, a
 * /24 or /48 in a column of its own (decision 27.10), and nothing finer. The
 * detail of an action is a short summary by a list of fields per action,
 * checked by the server before it is written.
 */

/** Days an audit row is kept (RETENTION_DAYS.adminAudit). */
export const ADMIN_AUDIT_RETENTION_DAYS = 365;

/**
 * A-288: how many refused sign-ins the log writes row by row in an hour; past
 * that, one summary row per hour and key counts the rest. Sign-in itself is
 * not limited by this, only the log: the login route keeps its own rate limit
 * per address, and guessing spread over many addresses (5 a minute from each)
 * would otherwise write a row per guess for a year.
 *
 * 20 per network (/24 or /48): an admin who mistypes does not come near it,
 * a guesser from one network does in minutes. 300 in all: past it the log
 * keeps the sign-ins that matter (every success and every refusal that locked
 * an account, both written whatever the count) and a count of the rest.
 */
export const ADMIN_AUDIT_LOGIN_REFUSAL_CAP = { perNetwork: 20, all: 300, windowSeconds: 3600 } as const;

/** Wave 1, decisions 26.10; wave 2 (sign-in, admins, tokens, settings, bulk
 *  user actions), decisions 27.10. */
export const ADMIN_AUDIT_ACTIONS = [
  'auth.login',
  'admin.register',
  'admin.2fa.enable',
  'admin.2fa.disable',
  'apiToken.create',
  'apiToken.revoke',
  'settings.update',
  'users.bulk',
  'user.delete',
  'user.credentials.reissue',
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

export const ADMIN_AUDIT_TARGET_KINDS = ['user', 'node', 'cascade', 'node_policy', 'admin', 'api_token', 'settings'] as const;
export type AdminAuditTargetKind = (typeof ADMIN_AUDIT_TARGET_KINDS)[number];

/** anonymous: a refused sign-in, where nobody is signed in yet. */
export type AdminAuditActorKind = 'admin' | 'api_token' | 'system' | 'anonymous';

/** What users.bulk did to each user it reached (POST /api/users/bulk). */
export type AdminAuditBulkAction = 'extend' | 'reset-traffic' | 'revoke' | 'delete' | 'enable' | 'disable';
export type AdminAuditOutcome = 'ok' | 'refused' | 'failed';

/** What each action keeps as its detail. A refused or failed action keeps
 *  only what was known before it: the policy of an attach, nothing (null) for
 *  the rest, since their summary is of what was done. */
export interface AdminAuditDetails {
  /** twoFactor: the second step was asked; locked: this refusal locked the
   *  account (the refusals while it stays locked are not written). The
   *  second shape is the summary of the refusals past the cap of their hour
   *  (ADMIN_AUDIT_LOGIN_REFUSAL_CAP, A-288): how many were not written, in the
   *  hour that began at windowStart. */
  'auth.login': { twoFactor: boolean; locked?: true } | { suppressed: number; windowStart: string };
  'admin.register': null;
  'admin.2fa.enable': null;
  'admin.2fa.disable': null;
  /** ['*'] for a full token. */
  'apiToken.create': { scopes: string[] };
  'apiToken.revoke': { scopes: string[] };
  /** The setting names whose value changed, never the values. */
  'settings.update': { changed: string[] };
  /** One row for the whole request; userIds only of the users it was done
   *  to, so a user's history shows it only where it touched them. */
  'users.bulk': {
    action: AdminAuditBulkAction;
    requested: number;
    succeeded: number;
    failed: number;
    expireDays?: number;
    userIds: string[];
  };
  'user.delete': { erasedAfter: string };
  /** A-053: nothing beyond the fact; what is issued is the same every time. */
  'user.credentials.reissue': null;
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
  /** auth.login only: the network the attempt came from, IPv4 /24 or IPv6
   *  /48 ("203.0.113.0/24"), never the address; null on every other action.
   *  Behind a proxy the panel does not trust (TRUST_PROXY_HOPS) it is the
   *  proxy's network. */
  sourceNetwork: string | null;
}

export interface AdminAuditListResponse {
  events: AdminAuditEventDto[];
  /** null when there is no further page. */
  nextCursor: string | null;
}
