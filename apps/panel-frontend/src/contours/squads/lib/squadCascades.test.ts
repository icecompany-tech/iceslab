import { describe, expect, it } from 'vitest';
import {
  canonicalAcl,
  cascadeShape,
  exitAclInvalid,
  isDuplicateExitAcl,
  nodePolicyLeadsInto,
  setCascadeOn,
  squadCascades,
  squadExitsSummary,
  toggleCascadeExit,
  type NodePolicyRules,
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
    { id: 'entry', name: 'ru-01', countryCode: 'RU', policyId: 'np1' },
    { id: 'de', name: 'de-01', countryCode: 'DE', policyId: null },
    { id: 'nl', name: 'nl-01', countryCode: 'NL', policyId: null },
  ],
  squads: [{ id: 'other', profileIds: ['p1'], hostIds: [], policyIds: ['noads'] }],
  policies: [{ id: 'noads', name: 'Без рекламы', ordinal: 1 }],
  // The entry node's policy sends youtube into direction d1.
  nodePolicies: [
    {
      id: 'np1',
      rules: [
        { enabled: true, action: { kind: 'direct', directionId: null } },
        { enabled: true, action: { kind: 'cascade', directionId: 'd1' } },
      ],
    },
  ] as NodePolicyRules[] | null,
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

  it('суженные выходы по exitAcl (по направлению), политика соседнего сквада предлагается', () => {
    const [c] = squadCascades('me', state({ exitAcl: [{ cascadeId: 'c1', directionIds: ['d2'] }] }), world);
    expect(c!.exitsNarrowed).toBe(true);
    expect(c!.aclField).toBe('directionIds');
    expect(c!.exits.map((e) => e.allowed)).toEqual([false, true]);
    expect(c!.policiesToOffer).toEqual([{ id: 'noads', name: 'Без рекламы' }]);
    // Уже выданная скваду политика не предлагается.
    expect(squadCascades('me', state({ policyIds: ['noads'] }), world)[0]!.policiesToOffer).toEqual([]);
  });

  it('ответ сервера несёт оба списка: читается directionIds, exitNodeIds только для показа', () => {
    const acl = [{ cascadeId: 'c1', directionIds: ['d2'], exitNodeIds: ['de'] }];
    expect(squadCascades('me', state({ exitAcl: acl }), world)[0]!.exits.map((e) => e.allowed)).toEqual([false, true]);
  });

  it('направление на именованном выходе без нод выдаётся по id, как любое другое (A-149)', () => {
    const w = {
      ...world,
      cascades: [{ ...cascade, directions: [...cascade.directions, { id: 'd3', tag: 3, countryCode: 'US', nodeIds: [], outboundId: 'o1' }] } as unknown as Cascade],
    };
    const [c] = squadCascades('me', state({ exitAcl: [{ cascadeId: 'c1', directionIds: ['d3'] }] }), w);
    expect(c!.exits.map((e) => [e.aclIds, e.allowed])).toEqual([
      [['d1'], false],
      [['d2'], false],
      [['d3'], true],
    ]);
  });

  it('старый каскад без positions: вход и выходы по hops, ключ acl это ноды', () => {
    const shape = cascadeShape({
      positions: [],
      directions: [],
      hops: [
        { id: 'x2', nodeId: 'de', nodeName: 'de', position: 1, entryProtocol: null, linkProtocol: null },
        { id: 'x1', nodeId: 'entry', nodeName: 'ru', position: 0, entryProtocol: 'xray', linkProtocol: 'xray' },
      ],
    });
    expect(shape).toEqual({
      byDirection: false,
      entryNodeIds: ['entry'],
      directions: [{ key: 'x2', tag: 1, countryCode: null, nodeIds: ['de'] }],
    });
  });
});

describe('canonicalAcl: одна строка на запись, как экран её шлёт', () => {
  it('направления: только directionIds; старый каскад: exitNodeIds; выключен: directionIds []', () => {
    expect(
      canonicalAcl([
        { cascadeId: 'a', directionIds: ['d1'], exitNodeIds: ['de'] },
        { cascadeId: 'b', directionIds: [], exitNodeIds: ['n1'] },
        { cascadeId: 'c', directionIds: [], exitNodeIds: [] },
      ]),
    ).toEqual([
      { cascadeId: 'a', directionIds: ['d1'] },
      { cascadeId: 'b', exitNodeIds: ['n1'] },
      { cascadeId: 'c', directionIds: [] },
    ]);
  });
});

describe('toggleCascadeExit: сузить и расширить выходы так, как их читает сервер', () => {
  const exits = [
    { aclIds: ['d1'], allowed: true },
    { aclIds: ['d2'], allowed: true },
  ];

  it('выключить выход у каскада без строк: пишутся остальные направления', () => {
    expect(toggleCascadeExit([], 'c1', 'directionIds', exits, exits[0]!)).toEqual([{ cascadeId: 'c1', directionIds: ['d2'] }]);
  });

  it('включить обратно все: строки уходят, а не лежат полным списком', () => {
    const acl = [{ cascadeId: 'c1', directionIds: ['d2'] }];
    expect(toggleCascadeExit(acl, 'c1', 'directionIds', exits, { aclIds: ['d1'], allowed: false })).toEqual([]);
  });

  it('последний выход не снимается: пустой список это выключенный каскад, для него переключатель', () => {
    const acl = [{ cascadeId: 'c1', directionIds: ['d2'] }];
    expect(toggleCascadeExit(acl, 'c1', 'directionIds', exits, { aclIds: ['d2'], allowed: true })).toBeNull();
  });

  it('у выключенного каскада выходы не двигаются', () => {
    const acl = [{ cascadeId: 'c1', directionIds: [] }];
    expect(toggleCascadeExit(acl, 'c1', 'directionIds', exits, { aclIds: ['d1'], allowed: false })).toBe(acl);
  });

  it('старый каскад по хопам: список нод', () => {
    const hopExits = [
      { aclIds: ['de'], allowed: true },
      { aclIds: ['nl'], allowed: true },
    ];
    expect(toggleCascadeExit([], 'c1', 'exitNodeIds', hopExits, hopExits[0]!)).toEqual([{ cascadeId: 'c1', exitNodeIds: ['nl'] }]);
  });
});

describe('три состояния каскада для сквада', () => {
  const row = (acl: SquadState['exitAcl']) => squadCascades('me', state({ exitAcl: acl }), world)[0]!;

  it('записи нет: включён, все выходы', () => {
    expect(row([])).toMatchObject({ off: false, exitsNarrowed: false, handedOut: true });
  });

  it('список: включён, сужен', () => {
    expect(row([{ cascadeId: 'c1', directionIds: ['d2'] }])).toMatchObject({ off: false, exitsNarrowed: true });
  });

  it('пустой список: выключен, не сужен, ни один выход не выдаётся; страна входа для подписи', () => {
    const c = row([{ cascadeId: 'c1', directionIds: [], exitNodeIds: [] }]);
    expect(c).toMatchObject({ off: true, exitsNarrowed: false, entryCountries: ['RU'] });
    expect(c.exits.map((e) => e.allowed)).toEqual([false, false]);
  });

  it('A-277: выключен или сужен, правила политики ноды в каскад на сквад не действуют; все выходы: строки нет', () => {
    expect(row([]).nodePolicyNote).toBeNull();
    expect(row([{ cascadeId: 'c1', directionIds: ['d2'] }]).nodePolicyNote).toBe('gated');
    expect(row([{ cascadeId: 'c1', directionIds: [], exitNodeIds: [] }]).nodePolicyNote).toBe('gated');
  });

  it('A-277: вход hysteria или AmneziaWG: юзера не различить, оговорка «кроме входов»', () => {
    for (const proto of ['hysteria', 'amneziawg']) {
      const c = { ...cascade, positions: [{ ...cascade.positions[0]!, entryProtocol: proto }] } as unknown as Cascade;
      const r = squadCascades('me', state({ exitAcl: [{ cascadeId: 'c1', directionIds: ['d1'] }] }), { ...world, cascades: [c] })[0]!;
      expect(r.nodePolicyNote).toBe('gated-except-chain');
    }
  });

  it('A-283: у политики ноды входа нет правила в этот каскад (или политики нет): строки нет', () => {
    const narrowed = state({ exitAcl: [{ cascadeId: 'c1', directionIds: ['d2'] }] });
    const noRule = { ...world, nodePolicies: [{ id: 'np1', rules: [{ enabled: true, action: { kind: 'direct', directionId: null } }] }] };
    expect(squadCascades('me', narrowed, noRule)[0]!.nodePolicyNote).toBeNull();
    // Rule switched off: not drawn by the server, does not count.
    const off = { ...world, nodePolicies: [{ id: 'np1', rules: [{ enabled: false, action: { kind: 'cascade', directionId: 'd1' } }] }] };
    expect(squadCascades('me', narrowed, off)[0]!.nodePolicyNote).toBeNull();
    // The policy deleted: the node runs none.
    const none = { ...world, nodes: world.nodes.map((n) => ({ ...n, policyId: null })) };
    expect(squadCascades('me', narrowed, none)[0]!.nodePolicyNote).toBeNull();
  });

  it('A-283: не известно, ведут ли правила в каскад: «unknown», не «нет»', () => {
    const narrowed = state({ exitAcl: [{ cascadeId: 'c1', directionIds: ['d2'] }] });
    // Node policies did not arrive.
    expect(squadCascades('me', narrowed, { ...world, nodePolicies: null })[0]!.nodePolicyNote).toBe('unknown');
    // The node list did not say which policy the entry runs.
    const noField = { ...world, nodes: world.nodes.map((n) => ({ id: n.id, name: n.name, countryCode: n.countryCode })) };
    expect(squadCascades('me', narrowed, noField)[0]!.nodePolicyNote).toBe('unknown');
    // The entry runs a policy the loaded list does not have.
    expect(squadCascades('me', narrowed, { ...world, nodePolicies: [] })[0]!.nodePolicyNote).toBe('unknown');
    // The node list did not arrive at all.
    expect(squadCascades('me', narrowed, { ...world, nodes: [] })[0]!.nodePolicyNote).toBe('unknown');
    // Every exit: no line, whatever is known.
    expect(squadCascades('me', state(), { ...world, nodePolicies: null })[0]!.nodePolicyNote).toBeNull();
  });

  it('nodePolicyLeadsInto: «да» по одному правилу даже при неполном знании, «нет» только при полном', () => {
    const nodes = [
      { id: 'a', name: 'a', countryCode: null, policyId: 'np1' },
      { id: 'b', name: 'b', countryCode: null },
    ];
    const policies = [{ id: 'np1', rules: [{ enabled: true, action: { kind: 'cascade', directionId: 'd1' } }] }];
    expect(nodePolicyLeadsInto(['a', 'b'], ['d1'], nodes, policies)).toBe(true);
    expect(nodePolicyLeadsInto(['a', 'b'], ['d9'], nodes, policies)).toBeNull();
    expect(nodePolicyLeadsInto(['a'], ['d9'], nodes, policies)).toBe(false);
    expect(nodePolicyLeadsInto(['a'], [], nodes, policies)).toBe(false);
  });

  it('страна входа неизвестна хотя бы у одной ноды: страны нет вовсе', () => {
    const w = { ...world, nodes: world.nodes.map((n) => (n.id === 'entry' ? { ...n, countryCode: null } : n)) };
    expect(squadCascades('me', state(), w)[0]!.entryCountries).toBeNull();
  });
});

describe('setCascadeOn: переходы переключателя, одна запись на каскад', () => {
  const ids = ['d1', 'd2'];
  const other = { cascadeId: 'c2', directionIds: ['x'] };

  it('выкл из «все выходы»: запись с пустым списком, парковать нечего', () => {
    expect(setCascadeOn([other], 'c1', false, 'directionIds', ids)).toEqual({
      acl: [other, { cascadeId: 'c1', directionIds: [] }],
      parked: undefined,
    });
  });

  it('выкл из суженного: запись заменяется, прежний список паркуется', () => {
    const r = setCascadeOn([{ cascadeId: 'c1', directionIds: ['d2'] }, other], 'c1', false, 'directionIds', ids);
    expect(r).toEqual({ acl: [other, { cascadeId: 'c1', directionIds: [] }], parked: ['d2'] });
    expect(r.acl.filter((e) => e.cascadeId === 'c1')).toHaveLength(1);
  });

  it('вкл без паркованного: запись снимается, все выходы', () => {
    expect(setCascadeOn([{ cascadeId: 'c1', directionIds: [] }, other], 'c1', true, 'directionIds', ids)).toEqual({ acl: [other] });
  });

  it('вкл с паркованным: возвращается прежний суженный список', () => {
    expect(setCascadeOn([{ cascadeId: 'c1', directionIds: [] }], 'c1', true, 'directionIds', ids, ['d2'])).toEqual({
      acl: [{ cascadeId: 'c1', directionIds: ['d2'] }],
    });
  });

  it('паркованный читается по сегодняшним выходам: ушедшее направление выпадает, полный список это не сужение', () => {
    const acl = [{ cascadeId: 'c1', directionIds: [] }];
    expect(setCascadeOn(acl, 'c1', true, 'directionIds', ids, ['gone'])).toEqual({ acl: [] });
    expect(setCascadeOn(acl, 'c1', true, 'directionIds', ids, ['d1', 'd2'])).toEqual({ acl: [] });
  });

  it('просьба о том же состоянии ничего не меняет', () => {
    const offAcl = [{ cascadeId: 'c1', directionIds: [] }];
    expect(setCascadeOn(offAcl, 'c1', false, 'directionIds', ids, ['d2'])).toEqual({ acl: offAcl, parked: ['d2'] });
    const onAcl = [{ cascadeId: 'c1', directionIds: ['d2'] }];
    expect(setCascadeOn(onAcl, 'c1', true, 'directionIds', ids)).toEqual({ acl: onAcl });
  });
});

describe('squadExitsSummary: колонка списка сквадов', () => {
  const ids = new Set(['c1', 'c2']);

  it('записей нет или они про удалённые каскады: все', () => {
    expect(squadExitsSummary([], ids)).toBe('all');
    expect(squadExitsSummary([{ cascadeId: 'gone', directionIds: [] }], ids)).toBe('all');
  });

  it('выключенные и суженные считаются отдельно, по любому из двух списков', () => {
    expect(
      squadExitsSummary(
        [
          { cascadeId: 'c1', directionIds: [], exitNodeIds: [] },
          { cascadeId: 'c2', directionIds: ['d2'], exitNodeIds: ['nl'] },
        ],
        ids,
      ),
    ).toEqual({ off: 1, narrowed: 1 });
  });
});

describe('exitAclInvalid: 400 EXIT_ACL_INVALID словами сервера', () => {
  it('слова сервера; вход проверяется первым', () => {
    const err = { response: { status: 400, data: { error: 'EXIT_ACL_INVALID', message: 'direction x is not a direction of cascade c1' } } };
    expect(exitAclInvalid(err)).toBe('direction x is not a direction of cascade c1');
    for (const v of [null, 'x', new Error('x'), { response: null }]) expect(exitAclInvalid(v)).toBeNull();
    expect(exitAclInvalid({ response: { status: 409, data: { error: 'EXIT_ACL_INVALID' } } })).toBeNull();
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
