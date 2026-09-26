import {
  buildTopologyFragmentsForNode,
  topologyReceivingPorts,
  LINK_PORT_BASE,
} from './cascade.config.js';
import { describe, expect, it } from 'vitest';
import {
  CascadeValidationError,
  countLinks,
  validateCascadeTopology,
} from './cascade.validation.js';
import type { CascadeDirectionInput, CascadePositionInput } from './cascade.schemas.js';

const N = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const entry = (
  nodeIds: string[],
  over: Partial<CascadePositionInput> = {},
): CascadePositionInput => ({
  nodeIds,
  position: 0,
  entryProtocol: 'xray',
  linkProtocol: 'xray',
  ...over,
});

const transit = (
  position: number,
  nodeIds: string[],
  over: Partial<CascadePositionInput> = {},
): CascadePositionInput => ({ nodeIds, position, linkProtocol: 'xray', ...over });

const dir = (
  nodeIds: string[],
  over: Partial<CascadeDirectionInput> = {},
): CascadeDirectionInput => ({ nodeIds, ...over });

// Field incident 2026-08-08: the entry rule carried `vlessRoute` as an ARRAY of
// numbers. xray parses that field with its port-list parser, so the whole
// config failed with "invalid port: [1, 257]" and every entry node's core
// refused to start. Structure tests passed the entire time, because they never
// asked whether xray would accept the result.
describe('buildTopologyFragmentsForNode wire format', () => {
  const entryNode = N(1);
  const exitNode = N(2);
  const input = {
    positions: [{ position: 0, nodeIds: [entryNode] }],
    directions: [{ tag: 7, nodeIds: [exitNode] }],
    links: [
      {
        fromNodeId: entryNode,
        toNodeId: exitNode,
        directionTag: 7,
        cred: { protocol: 'vless' as const, port: 24000, uuid: 'u-1' },
      },
    ],
    hosts: new Map([
      [entryNode, 'entry.example'],
      [exitNode, 'exit.example'],
    ]),
    policies: [{ ordinal: 1, directDomains: [], blockDomains: [] }],
  };

  it('emits vlessRoute as a comma-separated STRING, not an array', () => {
    const cfg = buildTopologyFragmentsForNode(entryNode, input)!;
    const rule = cfg.routingRules.find((r) => 'vlessRoute' in r)!;
    expect(typeof rule.vlessRoute).toBe('string');
    // Direction tag 7 -> plain profile 7, policy ordinal 1 -> 263.
    expect(rule.vlessRoute).toBe('7,263');
  });

  it('never puts a non-primitive in a routing rule port', () => {
    const cfg = buildTopologyFragmentsForNode(entryNode, input)!;
    for (const r of cfg.routingRules) {
      if ('port' in r) expect(['string', 'number']).toContain(typeof r.port);
    }
  });
});

describe('validateCascadeTopology', () => {
  it('accepts the old chain shape: one entry, one direction', () => {
    const t = validateCascadeTopology([entry([N(1)])], [dir([N(2)])]);
    expect(t.positions).toHaveLength(1);
    expect(t.linkCount).toBe(1);
  });

  it('accepts the old balancer shape: one entry, several directions', () => {
    const t = validateCascadeTopology([entry([N(1)])], [dir([N(2)]), dir([N(3)]), dir([N(4)])]);
    expect(t.linkCount).toBe(3);
  });

  it('accepts what the old model could not express: transits plus several directions', () => {
    const t = validateCascadeTopology(
      [entry([N(1)]), transit(1, [N(2)])],
      [dir([N(3)]), dir([N(4)])],
    );
    expect(t.linkCount).toBe(3); // 1x1 entry->transit, then 1x2 transit->directions
  });

  it('accepts a pool on every step and counts links as the product', () => {
    const t = validateCascadeTopology(
      [entry([N(1), N(2)]), transit(1, [N(3), N(4), N(5)])],
      [dir([N(6), N(7)])],
    );
    expect(t.linkCount).toBe(2 * 3 + 3 * 2);
  });

  it('sorts positions by index', () => {
    const t = validateCascadeTopology([transit(1, [N(2)]), entry([N(1)])], [dir([N(3)])]);
    expect(t.positions.map((p) => p.position)).toEqual([0, 1]);
  });

  it('refuses a direction with neither nodes nor an outbound (phase 10, ARCH 26.09)', () => {
    expect(() => validateCascadeTopology([entry([N(1)])], [dir([])])).toThrow(
      expect.objectContaining({ code: 'DIRECTION_EMPTY', directionIndex: 0 }),
    );
  });

  it('takes a direction on a named outbound with no nodes and no link', () => {
    const t = validateCascadeTopology(
      [entry([N(1)])],
      [{ ...dir([]), outboundId: '11111111-1111-4111-8111-111111111111' }],
    );
    expect(t.linkCount).toBe(0);
  });

  it('rejects a cascade with no direction, nobody could exit', () => {
    expect(() => validateCascadeTopology([entry([N(1)])], [])).toThrow(CascadeValidationError);
  });

  it('rejects a gap in positions', () => {
    expect(() =>
      validateCascadeTopology([entry([N(1)]), transit(2, [N(2)])], [dir([N(3)])]),
    ).toThrow(/contiguous/);
  });

  it('requires an entryProtocol on the entry and forbids it elsewhere', () => {
    expect(() =>
      validateCascadeTopology([entry([N(1)], { entryProtocol: undefined })], [dir([N(2)])]),
    ).toThrow(/entryProtocol/);
    expect(() =>
      validateCascadeTopology(
        [entry([N(1)]), transit(1, [N(2)], { entryProtocol: 'xray' })],
        [dir([N(3)])],
      ),
    ).toThrow(/only valid on the entry/);
  });

  it('requires a linkProtocol on EVERY position, including the last', () => {
    // v3 let the terminal hop omit it. In v4 the last position links to the
    // directions, so there is no terminal position at all.
    expect(() =>
      validateCascadeTopology([entry([N(1)], { linkProtocol: undefined })], [dir([N(2)])]),
    ).toThrow(/needs a linkProtocol/);
  });

  it('rejects a node used twice, across positions and directions alike', () => {
    expect(() =>
      validateCascadeTopology([entry([N(1)]), transit(1, [N(1)])], [dir([N(2)])]),
    ).toThrow(/more than once/);
    expect(() => validateCascadeTopology([entry([N(1)])], [dir([N(1)])])).toThrow(/more than once/);
    // ⚠ Two DIRECTIONS on one node is refused by a message of its own since
    // phase 5, and the difference is the point: each direction reaches its
    // nodes over its own leg, so the two legs would land on one node at one
    // port speaking two cells, and which one fails to bind is a race. The
    // message names both directions, because with five on a screen "a node
    // appears twice" leaves the operator to find which two.
    expect(() => validateCascadeTopology([entry([N(1)])], [dir([N(2)]), dir([N(2)])])).toThrow(
      /behind two directions/,
    );
    expect(() => validateCascadeTopology([entry([N(1)])], [dir([N(2)]), dir([N(2)])])).toThrow(
      /#1 and #2/,
    );
  });

  it('rejects a pool listing the same node twice', () => {
    expect(() => validateCascadeTopology([entry([N(1), N(1)])], [dir([N(2)])])).toThrow(
      /same node twice/,
    );
  });

  it('caps the path including the direction step', () => {
    const positions = [
      entry([N(1)]),
      transit(1, [N(2)]),
      transit(2, [N(3)]),
      transit(3, [N(4)]),
      transit(4, [N(5)]),
    ];
    expect(() => validateCascadeTopology(positions, [dir([N(6)])])).toThrow(/at most/);
  });

  it('caps links, and the message explains that pools multiply', () => {
    const entryNodes = Array.from({ length: 9 }, (_, i) => N(i + 1));
    const directions = Array.from({ length: 8 }, (_, i) => dir([N(100 + i)]));
    expect(() => validateCascadeTopology([entry(entryNodes)], directions)).toThrow(/72 links/);
  });
});

describe('topologyReceivingPorts', () => {
  /**
   * The walk that answers "which socket does this cascade need", phase 5.
   *
   * It used to answer with numbers alone, which was true while every leg rode
   * xray over TCP. Two of the four cells are QUIC now, and a number without a
   * transport is wrong in both directions at once: it refuses a TCP profile
   * that can legally share 24000 with a tuic leg, and it promises a UDP profile
   * the very socket that leg holds.
   */
  it('gives each leg the transport of its cell', () => {
    const ports = topologyReceivingPorts(
      [entry([N(1)])],
      [
        { nodeIds: [N(2)], linkProtocol: 'tuic' },
        { nodeIds: [N(3)] },
      ],
    );
    expect(ports).toEqual([
      { nodeId: N(2), port: LINK_PORT_BASE, transport: 'udp' },
      // Names no cell, so it is reached over the entry's, which is TCP.
      { nodeId: N(3), port: LINK_PORT_BASE, transport: 'tcp' },
    ]);
  });

  it('keeps both claims when one number is held on two transports', () => {
    // Deduplication is by node, port AND transport. Keyed without the
    // transport, whichever leg was walked first would silence the other, and
    // the cascade would ask about one of the two sockets it actually needs.
    const ports = topologyReceivingPorts(
      [entry([N(1), N(2)])],
      [{ nodeIds: [N(3)], linkProtocol: 'tuic' }, { nodeIds: [N(3)] }],
    );
    expect(ports).toEqual([
      { nodeId: N(3), port: LINK_PORT_BASE, transport: 'udp' },
      { nodeId: N(3), port: LINK_PORT_BASE, transport: 'tcp' },
    ]);
  });

  it('skips a leg whose cell cannot be read, because validation refuses it by name', () => {
    // Raw input reaches this walk: a value with no cell is refused elsewhere
    // with a message naming it, and throwing here would replace that sentence
    // with an internal error about a walk nobody has heard of.
    expect(
      topologyReceivingPorts([entry([N(1)])], [{ nodeIds: [N(2)], linkProtocol: 'hysteria' }]),
    ).toEqual([]);
  });
});

describe('countLinks', () => {
  it('is zero when the only direction has no nodes', () => {
    expect(countLinks([entry([N(1), N(2)])], [dir([])])).toBe(0);
  });

  it('sums every adjacent pair product', () => {
    expect(
      countLinks([entry([N(1), N(2)]), transit(1, [N(3)])], [dir([N(4)]), dir([N(5), N(6)])]),
    ).toBe(2 * 1 + 1 * 1 + 1 * 2);
  });
});
