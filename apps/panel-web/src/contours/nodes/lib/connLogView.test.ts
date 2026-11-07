import { describe, expect, it } from 'vitest';
import { connLogClearOf, connLogRefusal, connLogTraceOf } from '@/lib/old/connLog';
import { connLogClearFailures, connLogView } from '@/contours/nodes/lib/connLogView';

const check = (source: string, state: string, since: string | null = null, error?: string) => ({
  source,
  state,
  since,
  ...(error ? { error } : {}),
});
const trace = (present: boolean | null, checks: unknown[], since: string | null = null) => ({
  present,
  since,
  sources: ['journal', 'syslog'],
  checks,
});

describe('журнал соединений: четыре состояния', () => {
  it('present true: «есть, с даты», кнопка «Очистить»', () => {
    const t = connLogTraceOf(trace(true, [check('journal', 'found', '2026-10-20T10:00:00Z'), check('syslog', 'absent')], '2026-10-20T10:00:00Z'))!;
    const v = connLogView(t);
    expect(v.headline).toEqual({ kind: 'present', since: '2026-10-20T10:00:00Z' });
    expect(v.canClear).toBe(true);
  });
  it('present false: «нет», кнопки нет; absent у syslog это факт, не ошибка', () => {
    const v = connLogView(connLogTraceOf(trace(false, [check('journal', 'clean'), check('syslog', 'absent')]))!);
    expect(v.headline).toEqual({ kind: 'none' });
    expect(v.canClear).toBe(false);
    expect(v.lines.map((l) => [l.source, l.state, l.error])).toEqual([['journal', 'clean', null], ['syslog', 'absent', null]]);
  });
  it('present null: «проверить не удалось», failed со словами ноды; кнопки нет', () => {
    const v = connLogView(connLogTraceOf(trace(null, [check('journal', 'failed', null, 'journalctl: permission denied'), check('syslog', 'clean')]))!);
    expect(v.headline).toEqual({ kind: 'unknown' });
    expect(v.canClear).toBe(false);
    expect(v.lines[0]).toEqual({ source: 'journal', state: 'failed', since: null, error: 'journalctl: permission denied' });
  });
  it('409 UPDATE_AGENT: «обновите агент»; 502 со словами; 404; прочее null', () => {
    const r = (status: number, data: unknown) => ({ response: { status, data } });
    expect(connLogRefusal(r(409, { error: 'UPDATE_AGENT' }))).toEqual({ kind: 'update-agent' });
    expect(connLogRefusal(r(502, { error: 'CONN_LOG_NODE_FAILED', message: 'ssh timeout' }))).toEqual({ kind: 'node-failed', message: 'ssh timeout' });
    expect(connLogRefusal(r(404, { error: 'NOT_FOUND' }))).toEqual({ kind: 'not-found' });
    for (const e of [null, 'x', new Error('x'), { response: null }, r(409, { error: 'CONFLICT' }), r(500, { error: 'UPDATE_AGENT' }), r(409, null)]) {
      expect(connLogRefusal(e)).toBeNull();
    }
  });
});

describe('разбор ответа: вход первым', () => {
  it('мусор и неизвестные состояния: null, а не «чисто»', () => {
    for (const d of [null, 'x', {}, { present: 'yes', since: null, sources: [], checks: [] }, trace(false, [check('journal', 'gone')]), trace(false, [check('disk', 'clean')])]) {
      expect(connLogTraceOf(d)).toBeNull();
    }
  });
  it('очистка: неудачные шаги словами ноды, after прочитан', () => {
    const r = connLogClearOf({
      results: [
        { source: 'journal', state: 'cleared', steps: [{ command: 'journalctl --rotate', ok: true }, { command: 'journalctl --vacuum-time=1s', ok: true }] },
        { source: 'syslog', state: 'failed', steps: [{ command: 'truncate -s0 /var/log/syslog', ok: false, error: 'read-only file system' }] },
      ],
      after: trace(false, [check('journal', 'clean'), check('syslog', 'found', '2026-10-25T00:00:00Z')]),
    })!;
    expect(connLogClearFailures(r)).toEqual([{ source: 'syslog', command: 'truncate -s0 /var/log/syslog', error: 'read-only file system' }]);
    expect(r.after.present).toBe(false);
    expect(connLogClearOf({ results: [], after: null })).toBeNull();
  });
});
