import { describe, expect, it } from 'vitest';
import { cascadeShape, squadCascades, toggleCascadeExit, type SquadState } from '@/contours/squads/lib/squadCascades';
import type { Cascade } from '@/lib/domain/cascades';

const cascade = {
  id: 'c1',
  name: 'EU',
  enabled: true,
  mode: 'balancer',
  hops: [],
  positions: [{ position: 0, nodeIds: ['entry'], entryProtocol: 'xray', linkProtocol: 'vless' }],
  directions: [
    { id: 'd1', tag: 1, countryCode: 'DE', nodeIds: ['de'] },
    { id: 'd2', tag: 2, countryCode: 'NL', nodeIds: ['nl'] },
  ],
} as unknown as Cascade;

const world = {
  cascades: [cascade, { ...cascade, id: 'off', enabled: false }],
  hosts: [
    { id: 'h-entry', bindingId: 'b-entry', enabled: true, portOverride: null },
    { id: 'h-other', bindingId: 'b-other', enabled: true, portOverride: null },
  ],
  bindings: [
    { id: 'b-entry', nodeId: 'entry', profileId: 'p1', port: 443, publicPort: null },
    { id: 'b-other', nodeId: 'elsewhere', profileId: 'p1', port: 8443, publicPort: null },
  ],
  nodes: [
    { id: 'entry', name: 'ru-01', countryCode: 'RU' },
    { id: 'de', name: 'de-01', countryCode: 'DE' },
    { id: 'nl', name: 'nl-01', countryCode: 'NL' },
  ],
  squads: [{ id: 'other', profileIds: ['p1'], hostIds: [], policyIds: ['noads'] }],
  policies: [{ id: 'noads', name: 'Без рекламы', ordinal: 1 }],
};
const state = (s: Partial<SquadState> = {}): SquadState => ({
  profileIds: ['p1'],
  hostIds: [],
  restricted: false,
  exitAcl: [],
  policyIds: [],
  ...s,
});

describe('squadCascades: каскад как одно целое, статус как факт', () => {
  it('выдаётся: без ограничения хост входной ноды уже выдан; все выходы; выключенный каскад не виден', () => {
    const [c, ...rest] = squadCascades('me', state(), world);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ handedOut: true, notHandedOut: null, entryHostToAdd: null, exitsNarrowed: false });
    expect(c!.entry).toEqual([{ id: 'entry', name: 'ru-01', ports: [{ port: 443, handedOut: true }] }]);
    expect(c!.exits.map((e) => [e.countryCode, e.nodeNames, e.allowed])).toEqual([
      ['DE', ['de-01'], true],
      ['NL', ['nl-01'], true],
    ]);
  });

  it('не выдаётся, хост не выбран в ограничении: «выдать вход» добавит именно его', () => {
    const [c] = squadCascades('me', state({ restricted: true, hostIds: ['h-other'] }), world);
    expect(c).toMatchObject({ handedOut: false, notHandedOut: 'host-not-picked', entryHostToAdd: 'h-entry' });
    expect(c!.entry[0]!.ports).toEqual([{ port: 443, handedOut: false }]);
  });

  it('не выдаётся, профиль входа не выдан: ссылки нет', () => {
    const [c] = squadCascades('me', state({ profileIds: [] }), world);
    expect(c).toMatchObject({ handedOut: false, notHandedOut: 'no-granted-host', entryHostToAdd: null });
  });

  it('суженные выходы по exitAcl, политика соседнего сквада предлагается', () => {
    const [c] = squadCascades('me', state({ exitAcl: [{ cascadeId: 'c1', exitNodeIds: ['nl'] }] }), world);
    expect(c!.exitsNarrowed).toBe(true);
    expect(c!.exits.map((e) => e.allowed)).toEqual([false, true]);
    expect(c!.policiesToOffer).toEqual([{ id: 'noads', name: 'Без рекламы' }]);
    // Уже выданная скваду политика не предлагается.
    expect(squadCascades('me', state({ policyIds: ['noads'] }), world)[0]!.policiesToOffer).toEqual([]);
  });

  it('старый каскад без positions: вход и выходы по hops', () => {
    const shape = cascadeShape({
      positions: [],
      directions: [],
      hops: [
        { id: 'x2', nodeId: 'de', nodeName: 'de', position: 1, entryProtocol: null, linkProtocol: null },
        { id: 'x1', nodeId: 'entry', nodeName: 'ru', position: 0, entryProtocol: 'xray', linkProtocol: 'xray' },
      ],
    });
    expect(shape).toEqual({
      entryNodeIds: ['entry'],
      directions: [{ key: 'x2', tag: 1, countryCode: null, nodeIds: ['de'] }],
    });
  });
});

describe('toggleCascadeExit: сузить и расширить выходы так, как их читает сервер', () => {
  const exits = [
    { nodeIds: ['de'], allowed: true },
    { nodeIds: ['nl'], allowed: true },
  ];

  it('выключить выход у каскада без строк: пишутся остальные', () => {
    expect(toggleCascadeExit([], 'c1', exits, exits[0]!)).toEqual([{ cascadeId: 'c1', exitNodeIds: ['nl'] }]);
  });

  it('включить обратно все: строки уходят, а не лежат полным списком', () => {
    const acl = [{ cascadeId: 'c1', exitNodeIds: ['nl'] }];
    expect(toggleCascadeExit(acl, 'c1', exits, { nodeIds: ['de'], allowed: false })).toEqual([]);
  });

  it('последний выход не выключается: пустой список прочтётся как «все»', () => {
    const acl = [{ cascadeId: 'c1', exitNodeIds: ['nl'] }];
    expect(toggleCascadeExit(acl, 'c1', exits, { nodeIds: ['nl'], allowed: true })).toBeNull();
  });
});
