import { describe, expect, it } from 'vitest';
import { coreRemoveFacts, coreRowsInManifestOrder, firstRowOfEngine, readCascadeNeeds } from '@/contours/nodes/lib/coreRemove';
import type { Node, NodeCore } from '@/lib/domain/nodes';

const core = (c: Partial<NodeCore> & { name: NodeCore['name'] }): NodeCore => c as NodeCore;
type N = Pick<Node, 'cores' | 'intendedEngines' | 'cascadeNeedsEngines'>;
const node = (cores: NodeCore[], rest: Partial<N> = {}): N => ({
  cores: { cores, observedAt: '2026-09-24T00:00:00.000Z' } as Node['cores'],
  intendedEngines: ['xray', 'singbox', 'hysteria'],
  cascadeNeedsEngines: [],
  ...rest,
});
const sb = core({ name: 'tuic', engine: 'singbox', neededBy: 0 });

describe('coreRemoveFacts: «Как удалить» по фактам', () => {
  it('никому не нужно и все три факта есть: можно', () => {
    expect(coreRemoveFacts('singbox', node([sb]))).toEqual({ kind: 'allowed', dropped: false });
  });

  it('снято из ядер ноды, а на машине стоит: можно и сказано, что снято', () => {
    expect(coreRemoveFacts('singbox', node([sb], { intendedEngines: ['xray'] }))).toEqual({
      kind: 'allowed',
      dropped: true,
    });
  });

  it('три отказа по факту, каждый своей строкой; выключенный каскад с пометкой', () => {
    const f = coreRemoveFacts(
      'xray',
      node([core({ name: 'xray', engine: 'xray', neededBy: 3 })], {
        cascadeNeedsEngines: [
          {
            engine: 'xray',
            cascades: [
              { id: 'c1', name: 'EU', enabled: true },
              { id: 'c2', name: 'old', enabled: false },
            ],
          },
        ],
      }),
    );
    expect(f).toEqual({
      kind: 'refused',
      reasons: [
        { kind: 'hosts', count: 3 },
        { kind: 'cascade', name: 'EU', enabled: true },
        { kind: 'cascade', name: 'old', enabled: false },
      ],
    });
  });

  it('основного нет и нода без ядер допустима (25.09): единственное ядро удаляется, если никому не нужно', () => {
    const xr = core({ name: 'xray', engine: 'xray', neededBy: 0 });
    expect(coreRemoveFacts('xray', node([xr]))).toEqual({ kind: 'allowed', dropped: false });
    expect(coreRemoveFacts('xray', node([xr], { intendedEngines: ['xray'] }))).toEqual({ kind: 'allowed', dropped: false });
    expect(coreRemoveFacts('xray', node([xr], { intendedEngines: [] }))).toEqual({ kind: 'allowed', dropped: true });
  });

  it('поля каскадов нет (старая панель): не отказывать и не разрешать', () => {
    expect(coreRemoveFacts('singbox', node([sb], { cascadeNeedsEngines: undefined }))).toEqual({
      kind: 'unknown',
      missing: ['cascades'],
    });
  });

  it('молчание не отменяет факта «нет»: хосты ждут, а про каскады неизвестно, это отказ', () => {
    const f = coreRemoveFacts(
      'singbox',
      node([core({ name: 'tuic', engine: 'singbox', neededBy: 2 })], { cascadeNeedsEngines: undefined }),
    );
    expect(f).toEqual({ kind: 'refused', reasons: [{ kind: 'hosts', count: 2 }] });
  });

  it('нет neededBy или intendedEngines: тоже неизвестно', () => {
    expect(
      coreRemoveFacts('singbox', node([core({ name: 'tuic', engine: 'singbox' })], { intendedEngines: undefined })),
    ).toEqual({ kind: 'unknown', missing: ['hosts', 'intent'] });
  });

  it('файла нет или строки движка нет: удалять нечего', () => {
    expect(coreRemoveFacts('singbox', node([core({ name: 'tuic', engine: 'singbox', installed: false })]))).toEqual({
      kind: 'absent',
    });
    expect(coreRemoveFacts('mieru', node([sb]))).toEqual({ kind: 'absent' });
  });

  it('sing-box под несколькими протоколами: один движок, наибольшее neededBy', () => {
    const rows = [
      core({ name: 'hysteria', engine: 'singbox', neededBy: 0 }),
      core({ name: 'shadowsocks', engine: 'singbox', neededBy: 4 }),
    ];
    expect(coreRemoveFacts('singbox', node(rows))).toEqual({ kind: 'refused', reasons: [{ kind: 'hosts', count: 4 }] });
    expect([0, 1].map((i) => firstRowOfEngine(rows, i))).toEqual([true, false]);
  });
});

describe('coreRowsInManifestOrder: строки «Ядер» в порядке манифеста', () => {
  it('отчёт mtg, hysteria, xray, sing-box под двумя протоколами: xray, sing-box, hysteria, mtproto', () => {
    const rows = [
      core({ name: 'mtproto', engine: 'mtproto' }),
      core({ name: 'hysteria', engine: 'hysteria' }),
      core({ name: 'tuic', engine: 'singbox' }),
      core({ name: 'xray', engine: 'xray' }),
      core({ name: 'anytls', engine: 'singbox' }),
    ];
    expect(coreRowsInManifestOrder(rows).map((c) => c.name)).toEqual(['xray', 'tuic', 'anytls', 'hysteria', 'mtproto']);
  });

  it('строка без известного движка в конце; вход не меняется', () => {
    const rows = [core({ name: 'weird' as NodeCore['name'] }), core({ name: 'xray', engine: 'xray' })];
    expect(coreRowsInManifestOrder(rows).map((c) => c.name)).toEqual(['xray', 'weird']);
    expect(rows.map((c) => c.name)).toEqual(['weird', 'xray']);
  });
});

describe('readCascadeNeeds: разбор DTO сначала проверяет вход', () => {
  it('поля нет или не список: не факт', () => {
    for (const v of [undefined, null, 'x', 42, {}]) expect(readCascadeNeeds(v)).toBeNull();
  });

  it('пустой список: нода ни в одном каскаде', () => {
    expect(readCascadeNeeds([])?.size).toBe(0);
  });

  it('одна кривая запись делает весь список не фактом', () => {
    const good = { engine: 'xray', cascades: [{ id: 'c1', name: 'EU', enabled: true }] };
    expect(readCascadeNeeds([good, { engine: 'nope', cascades: [] }])).toBeNull();
    expect(readCascadeNeeds([good, { engine: 'singbox', cascades: [{ id: 'c2', name: 'x' }] }])).toBeNull();
    expect(readCascadeNeeds([good, { engine: 'singbox' }])).toBeNull();
    expect(readCascadeNeeds([good])?.get('xray')).toEqual([{ id: 'c1', name: 'EU', enabled: true }]);
  });
});
