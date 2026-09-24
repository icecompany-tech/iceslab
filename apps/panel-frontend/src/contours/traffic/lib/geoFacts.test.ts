import { describe, expect, it } from 'vitest';
import {
  geoAttention,
  geoNameProblem,
  geoRolloutFacts,
  geoScreenFacts,
  geoSetActions,
  geoSetState,
  uploadProblem,
} from '@/contours/traffic/lib/geoFacts';
import type { GeoRolloutPlan, GeoSet } from '@/lib/domain/geoSets';

const current = { version: 'a1b2c3d4e5f6', sha256: 'ff', sizeBytes: 10, fetchedAt: '2026-09-24T10:00:00.000Z', tagCount: 3 };

function set(p: Partial<GeoSet> = {}): GeoSet {
  return {
    id: 'g1',
    name: 'ru-blocked',
    kind: 'geosite',
    source: { type: 'url', url: 'https://example.com/g.dat', sha256Source: 'sidecar', refreshHours: 24 },
    format: 'dat',
    status: 'verified',
    checkedAt: '2026-09-24T10:00:00.000Z',
    error: null,
    current,
    usedByRules: 2,
    nodes: { total: 4, behind: 1 },
    createdAt: '2026-09-24T09:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    ...p,
  };
}

describe('geoScreenFacts', () => {
  it('404 или ответа нет: заглушка, а не «пусто»', () => {
    expect(geoScreenFacts({ notImplemented: true }).state).toBe('unavailable');
    expect(geoScreenFacts({}).state).toBe('unavailable');
    expect(geoScreenFacts({ sets: [] }).state).toBe('empty');
  });

  it('битые, потом в проверке, потом проверенные; есть проверка: переспрашивать', () => {
    const f = geoScreenFacts({
      sets: [
        set({ id: '1', name: 'b', status: 'verified' }),
        set({ id: '2', name: 'x', status: 'broken' }),
        set({ id: '3', name: 'a', status: 'verified' }),
        set({ id: '4', name: 'y', status: 'checking' }),
      ],
    });
    expect(f.sets.map((s) => s.name)).toEqual(['x', 'y', 'a', 'b']);
    expect(f.anyChecking).toBe(true);
  });
});

describe('geoSetState: битый это два разных текста', () => {
  it('broken без current: проверенной версии нет', () => {
    expect(geoSetState(set({ status: 'broken', current: null }))).toBe('broken-empty');
  });
  it('broken при current: обновление битое, на нодах прежняя', () => {
    expect(geoSetState(set({ status: 'broken' }))).toBe('broken-update');
  });
  it('checking и verified как есть', () => {
    expect(geoSetState(set({ status: 'checking', current: null }))).toBe('checking');
    expect(geoSetState(set())).toBe('verified');
  });
});

describe('geoSetActions', () => {
  it('ссылка и встроенный обновляются; загруженный заменяется файлом', () => {
    expect(geoSetActions(set())).toMatchObject({ refresh: true, replaceFile: false });
    expect(geoSetActions(set({ source: { type: 'builtin', tag: '202609240000' } }))).toMatchObject({ refresh: true });
    expect(geoSetActions(set({ source: { type: 'upload', filename: 'x.dat' } }))).toMatchObject({
      refresh: false,
      replaceFile: true,
    });
  });

  it('разослать только при проверенной версии, даже если последнее обновление битое', () => {
    expect(geoSetActions(set({ current: null, status: 'broken' })).rollout).toBe(false);
    expect(geoSetActions(set({ status: 'broken' })).rollout).toBe(true);
  });

  it('встроенный не удаляется; в проверке не трогаем источник и удаление', () => {
    expect(geoSetActions(set({ source: { type: 'builtin', tag: 't' } }))).toMatchObject({
      delete: false,
      deleteBlocked: 'builtin',
    });
    expect(geoSetActions(set({ status: 'checking', usedByRules: 0 }))).toMatchObject({
      refresh: false,
      delete: false,
      deleteBlocked: 'checking',
    });
  });

  it('на набор ссылаются правила: удаление недоступно по известному факту (как E28)', () => {
    expect(geoSetActions(set({ usedByRules: 5 }))).toMatchObject({ delete: false, deleteBlocked: 'used' });
    expect(geoSetActions(set({ usedByRules: 0 }))).toMatchObject({ delete: true, deleteBlocked: null });
  });
});

describe('geoAttention: строка над списком', () => {
  it('битые по именам и отстающие ноды; тишина, когда нечего сказать', () => {
    expect(geoAttention([set({ name: 'a', status: 'broken' }), set({ name: 'b' })], 2)).toEqual({
      broken: ['a'],
      nodesBehind: 2,
    });
    expect(geoAttention([set()], 0)).toBeNull();
  });
});

describe('geoRolloutFacts: окно «Разослать»', () => {
  const plan: GeoRolloutPlan = {
    version: 'v2',
    nodes: [
      { id: 'a', name: 'ru-01', from: 'v1', filesToSend: ['iceslab-ru-blocked.dat'], restartsXray: true },
      { id: 'b', name: 'se-01', from: null, filesToSend: ['iceslab-ru-blocked.ru.json'], restartsXray: false },
      { id: 'c', name: 'nl-01', from: 'v2', filesToSend: [], restartsXray: false },
    ],
    breaks: [],
  };

  it('кому уедет, кто уже на версии, у кого рестарт xray по именам', () => {
    const f = geoRolloutFacts(plan);
    expect(f.sending.map((n) => n.name)).toEqual(['ru-01', 'se-01']);
    expect(f.unchanged).toBe(1);
    expect(f.restarts).toEqual(['ru-01']);
    expect(f.blocked).toBe(false);
  });

  it('непустой breaks запрещает кнопку', () => {
    expect(
      geoRolloutFacts({ ...plan, breaks: [{ entry: 'ext:ru-blocked:gone', uses: [{ kind: 'node-policy', id: 'p', name: 'RU' }] }] })
        .blocked,
    ).toBe(true);
  });
});

describe('проверки ввода до отправки', () => {
  it('файл больше 64 МБ не уходит', () => {
    expect(uploadProblem(null)).toBe('none');
    expect(uploadProblem({ size: 64 * 1024 * 1024 })).toBeNull();
    expect(uploadProblem({ size: 64 * 1024 * 1024 + 1 })).toBe('too-large');
  });

  it('имя как у сервера: строчные, цифры, дефис, до 32; geosite и geoip заняты', () => {
    expect(geoNameProblem('')).toBe('empty');
    expect(geoNameProblem('RU list')).toBe('shape');
    expect(geoNameProblem('geoip')).toBe('reserved');
    expect(geoNameProblem('ru-blocked')).toBeNull();
  });
});
