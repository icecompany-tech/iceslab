import { describe, expect, it } from 'vitest';
import { liveAfterRemovalOf, nodeLingeringOf } from '@/lib/domain/lingering';

describe('nodeLingeringOf: снятые с ноды, у кого соединение ещё открыто (A-218)', () => {
  it('нет ключа: панель старше A-218, это не «никого»', () => {
    expect(nodeLingeringOf({ id: 'n1' })).toEqual({ kind: 'old-server' });
  });

  it('null: не проверено, тоже не «никого»', () => {
    expect(nodeLingeringOf({ id: 'n1', lingering: null })).toEqual({ kind: 'unchecked' });
  });

  it('пустой список: проверено, никого', () => {
    expect(nodeLingeringOf({ lingering: { observedAt: '2026-10-27T10:00:00Z', users: [] } })).toEqual({
      kind: 'known',
      observedAt: '2026-10-27T10:00:00Z',
      users: [],
    });
  });

  it('список: больше соединений выше, при равенстве по имени; неизвестный пользователь остаётся строкой', () => {
    const r = nodeLingeringOf({
      lingering: {
        observedAt: '2026-10-27T10:00:00Z',
        users: [
          { userId: 'u2', username: 'bob', status: 'disabled', sessions: 1 },
          { userId: null, username: null, status: null, sessions: 1 },
          { userId: 'u1', username: 'alice', status: 'expired', sessions: 3 },
          { userId: 'u3', username: 'anna', status: 'active', sessions: 1 },
        ],
      },
    });
    expect(r?.kind === 'known' && r.users.map((u) => u.username)).toEqual(['alice', null, 'anna', 'bob']);
  });

  it('кривой ответ: null, а не пустой список', () => {
    expect(nodeLingeringOf(null)).toBeNull();
    expect(nodeLingeringOf('x')).toBeNull();
    expect(nodeLingeringOf({ lingering: { users: [] } })).toBeNull();
    expect(nodeLingeringOf({ lingering: { observedAt: 'x', users: 'no' } })).toBeNull();
    expect(nodeLingeringOf({ lingering: { observedAt: 'x', users: [{ userId: 1, username: null, status: null, sessions: 1 }] } })).toBeNull();
    expect(nodeLingeringOf({ lingering: { observedAt: 'x', users: [{ userId: null, username: null, status: null, sessions: 0 }] } })).toBeNull();
    expect(nodeLingeringOf({ lingering: { observedAt: 'x', users: [{ userId: null, username: null, status: null }] } })).toBeNull();
  });
});

describe('liveAfterRemovalOf: где юзер, снятый, ещё держит соединение', () => {
  it('нет ключа или не список: null', () => {
    expect(liveAfterRemovalOf({ id: 'u1' })).toBeNull();
    expect(liveAfterRemovalOf({ liveAfterRemoval: null })).toBeNull();
    expect(liveAfterRemovalOf(undefined)).toBeNull();
  });

  it('пустой список остаётся пустым: «нигде среди проверенных», а не «нигде»', () => {
    expect(liveAfterRemovalOf({ liveAfterRemoval: [] })).toEqual([]);
  });

  it('строки как есть; одна кривая делает весь ответ null', () => {
    const row = { nodeId: 'n1', nodeName: 'aeza-de-01', sessions: 2, observedAt: '2026-10-27T10:00:00Z' };
    expect(liveAfterRemovalOf({ liveAfterRemoval: [row] })).toEqual([row]);
    expect(liveAfterRemovalOf({ liveAfterRemoval: [row, { ...row, sessions: -1 }] })).toBeNull();
    expect(liveAfterRemovalOf({ liveAfterRemoval: [{ ...row, nodeName: undefined }] })).toBeNull();
  });
});
