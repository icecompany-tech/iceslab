import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_KINDS,
  type AdminAuditAction,
  type AdminAuditBulkAction,
  type AdminAuditDetails,
  type AdminAuditEventDto,
  type AdminAuditTargetKind,
} from '@iceslab/shared';

/**
 * The audit log in words (screen «Журнал действий»). Every action and target
 * kind of the contract has its key here: the list is read from shared, and
 * auditWords.test.ts fails on an action or a kind with no string in ru or en.
 *
 * Keys are built from the names, so `admin.2fa.enable` becomes
 * `audit.action.admin_2fa_enable`: a dot inside an i18n key is a level.
 */
type T = (key: string, opts?: Record<string, unknown>) => string;

export const actionKey = (a: string) => `audit.action.${a.replaceAll('.', '_')}`;
export const targetKey = (k: AdminAuditTargetKind) => `audit.target.${k}`;
export const groupKey = (g: string) => `audit.group.${g}`;

type ConnLogState = NonNullable<AdminAuditDetails['node.connLog.clear']>['outcome'][number]['state'];

/** Exhaustive by type: a bulk action or a log state added to the contract
 *  does not build until it has its key here. */
export const BULK_KEY: Record<AdminAuditBulkAction, string> = {
  extend: 'audit.bulk.extend',
  'reset-traffic': 'audit.bulk.resetTraffic',
  revoke: 'audit.bulk.revoke',
  delete: 'audit.bulk.delete',
  enable: 'audit.bulk.enable',
  disable: 'audit.bulk.disable',
};
export const CONNLOG_KEY: Record<ConnLogState, string> = {
  cleared: 'audit.connLog.cleared',
  absent: 'audit.connLog.absent',
  failed: 'audit.connLog.failed',
};

/** The groups the filter offers, in contract order: the first segment of an
 *  action, sent as the prefix 'cascade.'. */
export const ACTION_GROUPS: readonly string[] = [...new Set(ADMIN_AUDIT_ACTIONS.map((a) => a.split('.')[0]!))];

/** The filter's value: '' (all), 'group:<g>' or an action. */
export function actionFilterParam(value: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('group:')) return `${value.slice('group:'.length)}.`;
  return (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(value) ? value : undefined;
}

/** «From» of the period picker, the moment `days` before `now`; null = all. */
export function periodFrom(days: number | null, now: Date): string | undefined {
  if (days === null) return undefined;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function actorWords(e: Pick<AdminAuditEventDto, 'actor'>, t: T): string {
  switch (e.actor.kind) {
    case 'anonymous':
      return t('audit.actor.anonymous');
    case 'system':
      return e.actor.label || t('audit.actor.system');
    case 'api_token':
      return t('audit.actor.token', { label: e.actor.label });
    default:
      return e.actor.label;
  }
}

export function actionWords(a: string, t: T): string {
  return (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(a) ? t(actionKey(a)) : a;
}

export function targetWords(e: Pick<AdminAuditEventDto, 'target'>, t: T): string {
  const known = (ADMIN_AUDIT_TARGET_KINDS as readonly string[]).includes(e.target.kind);
  const kind = known ? t(targetKey(e.target.kind)) : e.target.kind;
  return e.target.label ? `${kind} ${e.target.label}` : kind;
}

export function outcomeWords(e: Pick<AdminAuditEventDto, 'outcome' | 'refusal'>, t: T): string {
  if (e.outcome === 'refused') return e.refusal ? t('audit.outcome.refusedCode', { code: e.refusal }) : t('audit.outcome.refused');
  return e.outcome === 'failed' ? t('audit.outcome.failed') : t('audit.outcome.ok');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function day(iso: unknown, locale: string): string | null {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(locale);
}

/**
 * The lines of an opened row: the action's detail by its own fields, then the
 * network of a sign-in. The detail is read field by field and checked: a row
 * written by an older server, or with a field missing, says less, never
 * something wrong.
 */
export function detailLines(e: AdminAuditEventDto, t: T, locale: string): string[] {
  const d = e.detail && typeof e.detail === 'object' ? (e.detail as Record<string, unknown>) : null;
  const out: string[] = [];
  const action = e.action as AdminAuditAction;
  if (d) {
    switch (action) {
      case 'auth.login': {
        const suppressed = num(d.suppressed);
        if (suppressed !== null) {
          out.push(t('audit.detail.loginSuppressed', { count: suppressed, from: day(d.windowStart, locale) ?? '?' }));
        } else {
          if (d.twoFactor === true) out.push(t('audit.detail.loginTwoFactor'));
          if (d.locked === true) out.push(t('audit.detail.loginLocked'));
        }
        break;
      }
      case 'apiToken.create':
      case 'apiToken.revoke': {
        const scopes = strs(d.scopes);
        if (scopes.length) out.push(t('audit.detail.scopes', { scopes: scopes.includes('*') ? t('audit.detail.scopesAll') : scopes.join(', ') }));
        break;
      }
      case 'settings.update': {
        const changed = strs(d.changed);
        if (changed.length) out.push(t('audit.detail.settingsChanged', { names: changed.join(', ') }));
        break;
      }
      case 'users.bulk': {
        const bulk = typeof d.action === 'string' ? d.action : null;
        if (bulk) {
          const k = Object.hasOwn(BULK_KEY, bulk) ? BULK_KEY[bulk as AdminAuditBulkAction] : null;
          out.push(t('audit.detail.bulkAction', { action: k ? t(k) : bulk }));
        }
        const requested = num(d.requested);
        const succeeded = num(d.succeeded);
        const failed = num(d.failed);
        if (requested !== null && succeeded !== null && failed !== null) {
          out.push(t('audit.detail.bulkCounts', { requested, succeeded, failed }));
        }
        const days = num(d.expireDays);
        if (days !== null) out.push(t('audit.detail.bulkExpireDays', { count: days }));
        out.push(t('audit.detail.bulkUsers', { count: strs(d.userIds).length }));
        break;
      }
      case 'user.delete': {
        const after = day(d.erasedAfter, locale);
        if (after) out.push(t('audit.detail.erasedAfter', { date: after }));
        break;
      }
      case 'node.connLog.clear': {
        const parts = Array.isArray(d.outcome)
          ? d.outcome.flatMap((o) => {
              const r = o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
              if (typeof r.source !== 'string' || typeof r.state !== 'string') return [];
              const k = Object.hasOwn(CONNLOG_KEY, r.state) ? CONNLOG_KEY[r.state as ConnLogState] : null;
              return [`${r.source}: ${k ? t(k) : r.state}`];
            })
          : [];
        if (parts.length) out.push(parts.join(', '));
        break;
      }
      case 'node.cert.rotate': {
        const until = day(d.notAfter, locale);
        if (until) out.push(t('audit.detail.certUntil', { date: until }));
        break;
      }
      case 'cascade.create':
      case 'cascade.update':
      case 'cascade.delete':
      case 'cascade.enable':
      case 'cascade.disable': {
        const directions = num(d.directions);
        const nodes = num(d.nodes);
        if (directions !== null && nodes !== null) out.push(t('audit.detail.cascadeShape', { directions, nodes }));
        break;
      }
      case 'nodePolicy.create':
      case 'nodePolicy.update':
      case 'nodePolicy.delete': {
        // One row for the policy, the nodes it ran on counted in it (delete
        // included, by design): not a row per node.
        const rules = num(d.rules);
        const nodes = num(d.nodes);
        if (rules !== null && nodes !== null) out.push(t('audit.detail.policyShape', { rules, nodes }));
        break;
      }
      case 'nodePolicy.attach':
      case 'nodePolicy.detach': {
        if (typeof d.policyLabel === 'string' && d.policyLabel) out.push(t('audit.detail.policy', { label: d.policyLabel }));
        break;
      }
      default:
        break;
    }
  }
  if (e.sourceNetwork) out.push(t('audit.detail.network', { network: e.sourceNetwork }));
  return out;
}

