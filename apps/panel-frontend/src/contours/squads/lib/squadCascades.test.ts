import { describe, expect, it } from 'vitest';
import {
  cascadeShape,
  isDuplicateExitAcl,
  setCascadeOn,
  squadCascades,
  squadExitsSummary,
  toggleCascadeExit,
  type SquadState,
} from '@/contours/squads/lib/squadCascades';
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

  it('последний выход не снимается: пустой список это выключенный каскад, для него переключатель', () => {
    const acl = [{ cascadeId: 'c1', exitNodeIds: ['nl'] }];
    expect(toggleCascadeExit(acl, 'c1', exits, { nodeIds: ['nl'], allowed: true })).toBeNull();
  });

  it('у выключенного каскада выходы не двигаются', () => {
    const acl = [{ cascadeId: 'c1', exitNodeIds: [] }];
    expect(toggleCascadeExit(acl, 'c1', exits, { nodeIds: ['de'], allowed: false })).toBe(acl);
  });
});

describe('три состояния каскада для сквада', () => {
  const row = (acl: SquadState['exitAcl']) => squadCascades('me', state({ exitAcl: acl }), world)[0]!;

  it('записи нет: включён, все выходы', () => {
    expect(row([])).toMatchObject({ off: false, exitsNarrowed: false, handedOut: true });
  });

  it('список: включён, сужен', () => {
    expect(row([{ cascadeId: 'c1', exitNodeIds: ['nl'] }])).toMatchObject({ off: false, exitsNarrowed: true });
  });

  it('пустой список: выключен, не сужен, ни один выход не выдаётся; страна входа для подписи', () => {
    const c = row([{ cascadeId: 'c1', exitNodeIds: [] }]);
    expect(c).toMatchObject({ off: true, exitsNarrowed: false, entryCountries: ['RU'] });
    expect(c.exits.map((e) => e.allowed)).toEqual([false, false]);
  });

  it('страна входа неизвестна хотя бы у одной ноды: страны нет вовсе', () => {
    const w = { ...world, nodes: world.nodes.map((n) => (n.id === 'entry' ? { ...n, countryCode: null } : n)) };
    expect(squadCascades('me', state(), w)[0]!.entryCountries).toBeNull();
  });
});

describe('setCascadeOn: переходы переключателя, одна запись на каскад', () => {
  const nodes = ['de', 'nl'];
  const other = { cascadeId: 'c2', exitNodeIds: ['x'] };

  it('выкл из «все выходы»: запись с пустым списком, парковать нечего', () => {
    expect(setCascadeOn([other], 'c1', false, nodes)).toEqual({
      acl: [other, { cascadeId: 'c1', exitNodeIds: [] }],
      parked: undefined,
    });
  });

  it('выкл из суженного: запись заменяется, прежний список паркуется', () => {
    const r = setCascadeOn([{ cascadeId: 'c1', exitNodeIds: ['nl'] }, other], 'c1', false, nodes);
    expect(r).toEqual({ acl: [other, { cascadeId: 'c1', exitNodeIds: [] }], parked: ['nl'] });
    expect(r.acl.filter((e) => e.cascadeId === 'c1')).toHaveLength(1);
  });

  it('вкл без паркованного: запись снимается, все выходы', () => {
    expect(setCascadeOn([{ cascadeId: 'c1', exitNodeIds: [] }, other], 'c1', true, nodes)).toEqual({ acl: [other] });
  });

  it('вкл с паркованным: возвращается прежний суженный список', () => {
    expect(setCascadeOn([{ cascadeId: 'c1', exitNodeIds: [] }], 'c1', true, nodes, ['nl'])).toEqual({
      acl: [{ cascadeId: 'c1', exitNodeIds: ['nl'] }],
    });
  });

  it('паркованный читается по сегодняшним выходам: ушедшая нода выпадает, полный список это не сужение', () => {
    const acl = [{ cascadeId: 'c1', exitNodeIds: [] }];
    expect(setCascadeOn(acl, 'c1', true, nodes, ['gone'])).toEqual({ acl: [] });
    expect(setCascadeOn(acl, 'c1', true, nodes, ['de', 'nl'])).toEqual({ acl: [] });
  });

  it('просьба о том же состоянии ничего не меняет', () => {
    const offAcl = [{ cascadeId: 'c1', exitNodeIds: [] }];
    expect(setCascadeOn(offAcl, 'c1', false, nodes, ['nl'])).toEqual({ acl: offAcl, parked: ['nl'] });
    const onAcl = [{ cascadeId: 'c1', exitNodeIds: ['nl'] }];
    expect(setCascadeOn(onAcl, 'c1', true, nodes)).toEqual({ acl: onAcl });
  });
});

describe('squadExitsSummary: колонка списка сквадов', () => {
  const ids = new Set(['c1', 'c2']);

  it('записей нет или они про удалённые каскады: все', () => {
    expect(squadExitsSummary([], ids)).toBe('all');
    expect(squadExitsSummary([{ cascadeId: 'gone', exitNodeIds: [] }], ids)).toBe('all');
  });

  it('выключенные и суженные считаются отдельно', () => {
    expect(
      squadExitsSummary(
        [
          { cascadeId: 'c1', exitNodeIds: [] },
          { cascadeId: 'c2', exitNodeIds: ['nl'] },
        ],
        ids,
      ),
    ).toEqual({ off: 1, narrowed: 1 });
  });
});

describe('isDuplicateExitAcl: разбор 400 сначала проверяет вход', () => {
  it('мусор и чужие ошибки: нет', () => {
    for (const v of [null, undefined, 'x', 42, {}, { response: null }, new Error('boom')]) {
      expect(isDuplicateExitAcl(v)).toBe(false);
    }
    expect(isDuplicateExitAcl({ response: { status: 409, data: 'One exitAcl entry per cascade' } })).toBe(false);
    expect(isDuplicateExitAcl({ response: { status: 400, data: { message: 'Name is required' } } })).toBe(false);
  });

  it('400 с текстом сервера: да (тело снято с dev 24.09)', () => {
    const data = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid input',
      issues: [{ code: 'custom', path: ['exitAcl'], message: 'One exitAcl entry per cascade' }],
    };
    expect(isDuplicateExitAcl({ response: { status: 400, data } })).toBe(true);
  });
});
