import { describe, expect, it } from 'vitest';
import {
  geoScreenFacts,
  geoSetActions,
  rolloutFacts,
  rolloutSummary,
} from '@/contours/traffic/lib/geoFacts';
import type { GeoSet } from '@/lib/domain/geoSets';

/**
 * Гео-наборы: состояние экрана и раскладка по нодам.
 *
 * Главное здесь это четыре ответа раскладки. «Отстаёт» и «ушла вперёд» это
 * разные новости: первое значит, что пуш ещё не дошёл, второе, что файл на
 * ноде положили руками мимо панели, и увидеть второе стоит больше всего.
 */

function set(p: Partial<GeoSet> = {}): GeoSet {
  return {
    id: p.id ?? 'g1',
    name: p.name ?? 'geosite-ru',
    kind: p.kind ?? 'geosite',
    source: p.source ?? { type: 'url', url: 'https://example.com/geosite.dat' },
    version: p.version ?? '20260922a',
    sha256: p.sha256 ?? 'abc123',
    fetchedAt: p.fetchedAt ?? '2026-09-22T10:00:00.000Z',
    status: p.status ?? 'ready',
    error: p.error,
  };
}

describe('geoScreenFacts', () => {
  it('1. сервер отвечает 404: заглушка, а не ошибка и не пустота', () => {
    expect(geoScreenFacts({ notImplemented: true }).state).toBe('unavailable');
  });

  it('2. ответа ещё нет: тоже не «пусто»', () => {
    expect(geoScreenFacts({}).state).toBe('unavailable');
  });

  it('3. сервер ответил пустым списком: это ПУСТО', () => {
    expect(geoScreenFacts({ sets: [] }).state).toBe('empty');
  });

  it('4. сломанные и качающиеся идут первыми: экран открывают из-за них', () => {
    const f = geoScreenFacts({
      sets: [
        set({ id: '1', name: 'ready-b', status: 'ready' }),
        set({ id: '2', name: 'broken', status: 'invalid' }),
        set({ id: '3', name: 'ready-a', status: 'ready' }),
        set({ id: '4', name: 'loading', status: 'fetching' }),
      ],
    });
    expect(f.sets.map((x) => x.name)).toEqual(['broken', 'loading', 'ready-a', 'ready-b']);
    expect(f.total).toBe(4);
  });
});

describe('rolloutFacts', () => {
  const s = set({ version: 'v2', fetchedAt: '2026-09-22T10:00:00.000Z' });

  it('1. версия совпала: всё на месте', () => {
    const f = rolloutFacts(s, { nodeId: 'n1', version: 'v2', appliedAt: '2026-09-22T10:05:00.000Z' });
    expect(f.state).toBe('same');
  });

  it('2. нода ничего не сообщила: нет данных, а не «отстаёт»', () => {
    expect(rolloutFacts(s, { nodeId: 'n1', version: null, appliedAt: null }).state).toBe('unknown');
  });

  it('3. версия другая и применена ДО панельной: отстаёт, пуш не дошёл', () => {
    const f = rolloutFacts(s, { nodeId: 'n1', version: 'v1', appliedAt: '2026-09-22T09:00:00.000Z' });
    expect(f.state).toBe('behind');
  });

  it('4. версия другая и применена ПОСЛЕ панельной: файл положили руками', () => {
    // Панель такого не посылала: она забрала v2 в 10:00, а нода в 11:00
    // применила что-то другое. Это янтарное состояние, и его стоит увидеть.
    const f = rolloutFacts(s, { nodeId: 'n1', version: 'v3', appliedAt: '2026-09-22T11:00:00.000Z' });
    expect(f.state).toBe('diverged');
  });

  it('5. версия другая, а времени нет: сказать НЕЧЕГО, а не догадка', () => {
    // Версия это тег или первые 12 знаков sha, и sha не сравнивается на
    // «старше». Без отметки времени направление неизвестно.
    expect(rolloutFacts(s, { nodeId: 'n1', version: 'v1', appliedAt: null }).state).toBe('unknown');
    expect(
      rolloutFacts(set({ version: 'v2', fetchedAt: '' }), {
        nodeId: 'n1', version: 'v1', appliedAt: '2026-09-22T09:00:00.000Z',
      }).state,
    ).toBe('unknown');
  });

  it('6. факты несут саму версию и время: без них оператору некуда идти', () => {
    const f = rolloutFacts(s, { nodeId: 'n7', version: 'v1', appliedAt: '2026-09-22T09:00:00.000Z' });
    expect(f).toEqual({
      nodeId: 'n7', state: 'behind', version: 'v1', appliedAt: '2026-09-22T09:00:00.000Z',
    });
  });
});

describe('rolloutSummary', () => {
  const s = set({ version: 'v2', fetchedAt: '2026-09-22T10:00:00.000Z' });

  it('1. «на 3 из 4» считается по совпавшим, а не по отчитавшимся', () => {
    const sum = rolloutSummary(s, [
      { nodeId: '1', version: 'v2', appliedAt: '2026-09-22T10:01:00.000Z' },
      { nodeId: '2', version: 'v2', appliedAt: '2026-09-22T10:02:00.000Z' },
      { nodeId: '3', version: 'v2', appliedAt: '2026-09-22T10:03:00.000Z' },
      { nodeId: '4', version: 'v1', appliedAt: '2026-09-22T09:00:00.000Z' },
    ]);
    expect(sum.same).toBe(3);
    expect(sum.total).toBe(4);
    expect(sum.behind).toBe(1);
  });

  it('2. ушедшая вперёд нода поднимает флаг: это руками положенный файл', () => {
    const sum = rolloutSummary(s, [
      { nodeId: '1', version: 'v2', appliedAt: '2026-09-22T10:01:00.000Z' },
      { nodeId: '2', version: 'vX', appliedAt: '2026-09-22T12:00:00.000Z' },
    ]);
    expect(sum.diverged).toBe(1);
    expect(sum.hasDiverged).toBe(true);
  });

  it('3. молчащие ноды считаются отдельно и в «совпало» не идут', () => {
    const sum = rolloutSummary(s, [
      { nodeId: '1', version: null, appliedAt: null },
      { nodeId: '2', version: null, appliedAt: null },
    ]);
    expect(sum).toMatchObject({ same: 0, unknown: 2, total: 2, hasDiverged: false });
  });

  it('4. нод нет вовсе: считать нечего, но и падать не на чем', () => {
    expect(rolloutSummary(s, [])).toMatchObject({ same: 0, total: 0, hasDiverged: false });
  });
});

describe('geoSetActions', () => {
  it('1. url и builtin обновляются', () => {
    expect(geoSetActions(set({ source: { type: 'url', url: 'x' } })).canRefresh).toBe(true);
    expect(geoSetActions(set({ source: { type: 'builtin', tag: 'geosite' } })).canRefresh).toBe(true);
  });

  it('2. загруженный файл не «обновляется»: его загружают заново', () => {
    expect(geoSetActions(set({ source: { type: 'upload', filename: 'geo.dat' } })).canRefresh).toBe(false);
  });

  it('3. пока качается, не трогаем ни обновление, ни удаление', () => {
    const a = geoSetActions(set({ status: 'fetching' }));
    expect(a).toEqual({ canRefresh: false, canDelete: false });
  });

  it('4. удаление экран НЕ запрещает: кто держит набор, знает сервер', () => {
    // Запрет по неполному знанию это отказ по вычисленной величине. Сервер
    // ответит 409 и назовёт политики поимённо.
    expect(geoSetActions(set({ status: 'ready' })).canDelete).toBe(true);
    expect(geoSetActions(set({ status: 'invalid' })).canDelete).toBe(true);
  });
});
