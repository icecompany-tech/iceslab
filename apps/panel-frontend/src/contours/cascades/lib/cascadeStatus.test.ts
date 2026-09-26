import { describe, expect, it } from 'vitest';
import { cascadeStatusView, hopBroken } from '@/contours/cascades/lib/cascadeStatus';

const hop = (name: string, applied: boolean, broken?: string | null) => ({
  nodeId: name,
  name,
  applied,
  online: true,
  ...(broken !== undefined ? { broken } : {}),
});

describe('cascadeStatusView: последний пуш каскада (E46)', () => {
  it('ответа нет или мусор: loading', () => {
    for (const s of [undefined, null, 'x', 42]) expect(cascadeStatusView(s)).toEqual({ kind: 'loading' });
  });

  it('broken рисуется фразой сервера как есть', () => {
    expect(
      cascadeStatusView({
        done: false,
        broken: 'ru-01: chain process not running: no singbox binary on this node',
        hops: [hop('ru-01', true, 'chain process not running: no singbox binary on this node'), hop('de-01', true, null)],
      }),
    ).toEqual({ kind: 'broken', broken: 'ru-01: chain process not running: no singbox binary on this node' });
  });

  it('done=false без broken не «готово»: ждём тех, кто не принял', () => {
    expect(cascadeStatusView({ done: false, broken: null, hops: [hop('a', true), hop('b', false)] })).toEqual({
      kind: 'pending',
      waiting: ['b'],
    });
  });

  it('противоречие «done и broken»: сломан', () => {
    expect(cascadeStatusView({ done: true, broken: 'a: x', hops: [] }).kind).toBe('broken');
  });

  it('готово; сервер старше поля (нет broken) как раньше; пустая строка не причина', () => {
    expect(cascadeStatusView({ done: true, hops: [hop('a', true)] })).toEqual({ kind: 'done' });
    expect(cascadeStatusView({ done: true, broken: '  ', hops: [] })).toEqual({ kind: 'done' });
    expect(cascadeStatusView({ done: false })).toEqual({ kind: 'pending', waiting: [] });
  });
});

describe('hopBroken: причина у хопа', () => {
  it('строка агента, иначе null', () => {
    expect(hopBroken(hop('a', true, 'push refused: bad config'))).toBe('push refused: bad config');
    expect(hopBroken(hop('a', true, null))).toBeNull();
    expect(hopBroken(hop('a', true))).toBeNull();
    expect(hopBroken(hop('a', true, ''))).toBeNull();
    expect(hopBroken(null)).toBeNull();
  });
});
