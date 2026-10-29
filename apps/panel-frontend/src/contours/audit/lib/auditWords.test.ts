import { describe, expect, it } from 'vitest';
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS, type AdminAuditEventDto } from '@iceslab/shared';
import ru from '@/i18n/locales/ru';
import en from '@/i18n/locales/en';
import {
  ACTION_GROUPS,
  BULK_KEY,
  CONNLOG_KEY,
  actionFilterParam,
  actionKey,
  actionWords,
  actorWords,
  detailLines,
  groupKey,
  outcomeWords,
  periodFrom,
  targetKey,
  targetWords,
} from '@/contours/audit/lib/auditWords';

const at = (d: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d);
const has = (d: unknown, key: string) => typeof at(d, key) === 'string' || typeof at(d, `${key}_other`) === 'string';
/** Echoes the key and its values, so a line says which string it used. */
const t = (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k);

const ev = (p: Partial<AdminAuditEventDto>): AdminAuditEventDto => ({
  id: '1',
  at: '2026-10-29T10:00:00.000Z',
  actor: { kind: 'admin', id: 'a', label: 'root' },
  action: 'user.delete',
  target: { kind: 'user', id: 'u', label: 'alice' },
  outcome: 'ok',
  refusal: null,
  detail: null,
  sourceNetwork: null,
  ...p,
});

describe('каждое действие и цель контракта названы в обеих локалях', () => {
  it('ключи по спискам shared, не по копии', () => {
    const keys = [
      ...ADMIN_AUDIT_ACTIONS.map(actionKey),
      ...ACTION_GROUPS.map(groupKey),
      ...ADMIN_AUDIT_TARGET_KINDS.map(targetKey),
      ...Object.values(BULK_KEY),
      ...Object.values(CONNLOG_KEY),
      ...['at', 'actor', 'action', 'target', 'outcome'].map((c) => `audit.col.${c}`),
      ...['day', 'week', 'month', 'all'].map((p) => `audit.period.${p}`),
    ];
    const missing = keys.flatMap((k) => [...(has(ru, k) ? [] : [`ru ${k}`]), ...(has(en, k) ? [] : [`en ${k}`])]);
    expect(missing).toEqual([]);
  });
  it('группы фильтра это первые сегменты действий, по порядку контракта', () => {
    expect(ACTION_GROUPS).toEqual([...new Set(ADMIN_AUDIT_ACTIONS.map((a) => a.split('.')[0]))]);
  });
});

describe('фильтр и период', () => {
  it('действие: всё, группа префиксом, полное имя, чужое не уходит', () => {
    expect(actionFilterParam('')).toBeUndefined();
    expect(actionFilterParam('group:cascade')).toBe('cascade.');
    expect(actionFilterParam('nodePolicy.delete')).toBe('nodePolicy.delete');
    expect(actionFilterParam('drop.table')).toBeUndefined();
  });
  it('период от момента выбора; «всё» без from', () => {
    const now = new Date('2026-10-29T12:00:00.000Z');
    expect(periodFrom(1, now)).toBe('2026-10-28T12:00:00.000Z');
    expect(periodFrom(null, now)).toBeUndefined();
  });
});

describe('строка журнала словами', () => {
  it('кто: аноним, токен, система, админ', () => {
    expect(actorWords(ev({ actor: { kind: 'anonymous', id: null, label: '' } }), t)).toBe('audit.actor.anonymous');
    expect(actorWords(ev({ actor: { kind: 'api_token', id: 't', label: 'ci' } }), t)).toBe('audit.actor.token {"label":"ci"}');
    expect(actorWords(ev({ actor: { kind: 'system', id: null, label: '' } }), t)).toBe('audit.actor.system');
    expect(actorWords(ev({}), t)).toBe('root');
  });
  it('действие, цель с подписью на момент действия, исход с кодом отказа', () => {
    expect(actionWords('nodePolicy.delete', t)).toBe('audit.action.nodePolicy_delete');
    expect(actionWords('future.thing', t)).toBe('future.thing');
    expect(targetWords(ev({}), t)).toBe('audit.target.user alice');
    expect(outcomeWords(ev({ outcome: 'refused', refusal: 'TOTP_INVALID' }), t)).toBe('audit.outcome.refusedCode {"code":"TOTP_INVALID"}');
    expect(outcomeWords(ev({ outcome: 'failed' }), t)).toBe('audit.outcome.failed');
    expect(outcomeWords(ev({}), t)).toBe('audit.outcome.ok');
  });
});

describe('detailLines: подробности по полям действия', () => {
  it('users.bulk: действие, счётчики, срок, число затронутых', () => {
    const lines = detailLines(
      ev({
        action: 'users.bulk',
        detail: { action: 'extend', requested: 3, succeeded: 2, failed: 1, expireDays: 30, userIds: ['a', 'b'] },
      }),
      t,
      'ru-RU',
    );
    expect(lines).toEqual([
      'audit.detail.bulkAction {"action":"audit.bulk.extend"}',
      'audit.detail.bulkCounts {"requested":3,"succeeded":2,"failed":1}',
      'audit.detail.bulkExpireDays {"count":30}',
      'audit.detail.bulkUsers {"count":2}',
    ]);
  });
  it('nodePolicy.delete одной строкой: правила и ноды', () => {
    expect(detailLines(ev({ action: 'nodePolicy.delete', detail: { rules: 4, nodes: 2 } }), t, 'ru-RU')).toEqual([
      'audit.detail.policyShape {"rules":4,"nodes":2}',
    ]);
  });
  it('auth.login: второй шаг, блокировка, сводка отказов, сеть', () => {
    const login = (detail: unknown, sourceNetwork: string | null = '203.0.113.0/24') =>
      detailLines(ev({ action: 'auth.login', detail: detail as never, sourceNetwork }), t, 'en-US');
    expect(login({ twoFactor: true, locked: true })).toEqual([
      'audit.detail.loginTwoFactor',
      'audit.detail.loginLocked',
      'audit.detail.network {"network":"203.0.113.0/24"}',
    ]);
    const summary = login({ suppressed: 42, windowStart: '2026-10-29T10:00:00.000Z' }, null);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/^audit\.detail\.loginSuppressed \{"count":42,"from":".+"\}$/);
    expect(login({ twoFactor: false })).toEqual(['audit.detail.network {"network":"203.0.113.0/24"}']);
  });
  it('кривой detail говорит меньше, а не неправду', () => {
    expect(detailLines(ev({ action: 'users.bulk', detail: { action: 7, requested: 'x', userIds: 'no' } as never }), t, 'ru-RU')).toEqual([
      'audit.detail.bulkUsers {"count":0}',
    ]);
    expect(detailLines(ev({ action: 'users.bulk', detail: { action: 'wipe', userIds: [] } as never }), t, 'ru-RU')[0]).toBe(
      'audit.detail.bulkAction {"action":"wipe"}',
    );
    expect(detailLines(ev({ action: 'cascade.update', detail: 'x' as never }), t, 'ru-RU')).toEqual([]);
    expect(detailLines(ev({ action: 'user.delete', detail: { erasedAfter: 'not-a-date' } }), t, 'ru-RU')).toEqual([]);
    expect(
      detailLines(
        ev({ action: 'node.connLog.clear', detail: { outcome: [{ source: 'journal', state: 'cleared' }, null, { source: 'syslog', state: 'odd' }] } as never }),
        t,
        'ru-RU',
      ),
    ).toEqual(['journal: audit.connLog.cleared, syslog: odd']);
  });
});
