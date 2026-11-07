import { describe, expect, it } from 'vitest';
import { SYNC_CONFIRM_MINUTES, syncPoll } from '@/contours/nodes/lib/syncPoll';

const at = Date.parse('2026-10-26T21:47:00Z');
const s = (applied: boolean, online = true, configChangedAt = '2026-10-26T21:47:00Z') => ({ applied, online, configChangedAt });

describe('syncPoll: опрос «сохранено, не применено» до подтверждения', () => {
  it('сохранили: опрос каждые 5 с; агент применил: опрос редкий, плашки нет', () => {
    expect(syncPoll(s(false), at + 1_000)).toEqual({ intervalMs: 5_000, timedOut: false });
    expect(syncPoll(s(true), at + 6_000)).toEqual({ intervalMs: 30_000, timedOut: false });
  });
  it('не подтвердила за окно: опрос остановлен, сказано словами', () => {
    expect(syncPoll(s(false), at + SYNC_CONFIRM_MINUTES * 60_000 - 1)).toEqual({ intervalMs: 5_000, timedOut: false });
    expect(syncPoll(s(false), at + SYNC_CONFIRM_MINUTES * 60_000 + 1)).toEqual({ intervalMs: false, timedOut: true });
  });
  it('нода офлайн: ждёт cron, опрос 15 с без таймаута; ответа ещё нет: 15 с', () => {
    expect(syncPoll(s(false, false), at + 60 * 60_000)).toEqual({ intervalMs: 15_000, timedOut: false });
    expect(syncPoll(undefined, at)).toEqual({ intervalMs: 15_000, timedOut: false });
  });
  it('время изменения не разбирается: не «только что», а таймаут', () => {
    expect(syncPoll(s(false, true, 'garbage'), at)).toEqual({ intervalMs: false, timedOut: true });
  });
});
