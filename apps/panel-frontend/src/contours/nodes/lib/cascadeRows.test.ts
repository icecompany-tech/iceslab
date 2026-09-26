import { describe, expect, it } from 'vitest';
import { cascadePath, directionWhere } from '@/contours/nodes/lib/cascadeRows';
import type { Cascade } from '@/lib/domain/cascades';
import type { Node } from '@/lib/domain/nodes';

const node = (id: string, cc = 'DE') => ({ id, name: `n-${id}`, countryCode: cc, status: 'online' }) as unknown as Node;
const byId = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, node(id)] as const));
const overview = new Map([
  ['a', { status: 'online', todayBytes: 100 }],
  ['b', { status: 'offline', todayBytes: 50 }],
]);
type Shape = Pick<Cascade, 'mode' | 'hops' | 'positions' | 'directions'>;
const v4 = (positions: Shape['positions'], directions: Shape['directions']): Shape => ({
  mode: 'chain',
  hops: [],
  positions,
  directions,
});

describe('cascadePath: путь по positions и directions, hops только у старых', () => {
  it('один вход: позиция 0 это вход, выход по направлению, нога из позиции', () => {
    const p = cascadePath(
      v4(
        [{ position: 0, nodeIds: ['a'], entryProtocol: 'xray', linkProtocol: 'vless', linkParams: { underlay: 'awg' } }],
        [{ id: 'd1', tag: 1, countryCode: 'NL', nodeIds: ['d'] }],
      ),
      byId,
      overview,
    );
    expect(p.entry).toMatchObject({ nodeName: 'n-a', entryProtocol: 'xray', outCell: 'vless', outUnderlay: 'awg', todayBytes: 100 });
    expect(p.transits).toEqual([]);
    // Без своего ключа направление берёт ячейку и подложку последней позиции.
    expect(p.directions[0]).toMatchObject({ nodeName: 'n-d', tag: 1, countryCode: 'NL', inCell: 'vless', inUnderlay: 'awg' });
  });

  it('пул на входе: все ноды пула, первая называется, трафик суммой', () => {
    const p = cascadePath(
      v4(
        [{ position: 0, nodeIds: ['a', 'b', ''], entryProtocol: 'hysteria', linkProtocol: 'hy2' }],
        [{ id: 'd1', tag: 1, countryCode: '', nodeIds: ['d', 'e'] }],
      ),
      byId,
      overview,
    );
    expect(p.entry?.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(p.entry).toMatchObject({ nodeName: 'n-a', status: 'online', todayBytes: 150 });
    expect(p.entry?.outUnderlay).toBeUndefined();
    expect(p.directions[0]?.nodes.map((n) => n.id)).toEqual(['d', 'e']);
    // Страна направления пустая: берётся у первой ноды.
    expect(p.directions[0]?.countryCode).toBe('DE');
  });

  it('веер с транзитом: транзит по порядку, у каждого направления своя нога', () => {
    const p = cascadePath(
      v4(
        [
          { position: 1, nodeIds: ['b'], entryProtocol: null, linkProtocol: 'shadowsocks', linkParams: { congestion: 'bbr' } },
          { position: 0, nodeIds: ['a'], entryProtocol: 'xray', linkProtocol: 'hy2', linkParams: { underlay: 'awg' } },
        ],
        [
          { id: 'd1', tag: 1, countryCode: 'DE', nodeIds: ['d'], linkProtocol: 'tuic', linkParams: { underlay: 'awg' } },
          { id: 'd2', tag: 2, countryCode: 'NL', nodeIds: ['e'], linkProtocol: null },
          { id: 'd3', tag: 3, countryCode: 'SE', nodeIds: [] },
        ],
      ),
      byId,
      overview,
    );
    expect(p.entry).toMatchObject({ position: 0, outCell: 'hy2', outUnderlay: 'awg' });
    expect(p.transits.map((t) => [t.position, t.outCell, t.outUnderlay])).toEqual([[1, 'shadowsocks', undefined]]);
    expect(p.directions.map((d) => [d.tag, d.inCell, d.inUnderlay ?? null])).toEqual([
      [1, 'tuic', 'awg'],
      [2, 'shadowsocks', null],
      [3, 'shadowsocks', null],
    ]);
    // Пустой пул направления: тег есть, ноды нет.
    expect(p.directions[2]).toMatchObject({ nodeName: null, node: null, nodes: [] });
  });

  it('E57: направление на именованном выходе: имя и адрес выхода, страна выхода, не «ноды нет»', () => {
    const outbounds = new Map([['o1', { name: 'test-exit', address: 'ru.example.com:443', countryCode: 'RU' }]]);
    const p = cascadePath(
      v4(
        [{ position: 0, nodeIds: ['a'], entryProtocol: 'xray', linkProtocol: 'vless' }],
        [
          { id: 'd1', tag: 1, countryCode: '', nodeIds: [], outboundId: 'o1' },
          { id: 'd2', tag: 2, countryCode: 'NL', nodeIds: [], outboundId: 'o9' },
          { id: 'd3', tag: 3, countryCode: 'SE', nodeIds: [], outboundId: null },
          { id: 'd4', tag: 4, countryCode: 'DE', nodeIds: ['d'] },
        ],
      ),
      byId,
      overview,
      outbounds,
    );
    expect(p.directions[0]).toMatchObject({
      countryCode: 'RU',
      outbound: { id: 'o1', name: 'test-exit', address: 'ru.example.com:443', countryCode: 'RU' },
    });
    expect(p.directions.map(directionWhere)).toEqual([
      { kind: 'outbound', name: 'test-exit', address: 'ru.example.com:443' },
      { kind: 'outboundGone' },
      { kind: 'empty' },
      { kind: 'pool' },
    ]);
  });

  it('старый каскад без positions читается по hops: балансёр, выходы это хопы после входа', () => {
    const p = cascadePath(
      {
        mode: 'balancer',
        positions: [],
        directions: [],
        hops: [
          { id: 'h2', nodeId: 'd', nodeName: 'd-old', position: 1, entryProtocol: null, linkProtocol: null },
          { id: 'h1', nodeId: 'a', nodeName: 'a-old', position: 0, entryProtocol: 'xray', linkProtocol: 'xray' },
          { id: 'h3', nodeId: 'e', nodeName: 'e-old', position: 2, entryProtocol: null, linkProtocol: null },
        ],
      },
      byId,
      overview,
    );
    expect(p.entry).toMatchObject({ nodeName: 'n-a', outCell: 'xray' });
    expect(p.transits).toEqual([]);
    expect(p.directions.map((d) => [d.tag, d.nodeName, d.inCell])).toEqual([
      [1, 'n-d', 'xray'],
      [2, 'n-e', 'xray'],
    ]);
  });
});
