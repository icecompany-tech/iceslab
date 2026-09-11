import { describe, expect, it } from 'vitest';
import {
  buildTopologyFragmentsForNode,
  CascadeTopologyBrokenError,
  type TopologyLinkRow,
} from './cascade.config.js';

/**
 * A cascade that still points at a node which is gone.
 *
 * Found on the field stand: a direction listed a node id that `/api/nodes` does
 * not return. Measured on 2026-09-11, the old behaviour (skip the leg) had three
 * outcomes and every one of them was silent, the worst being a client that
 * egresses from the ENTRY country while its own config says otherwise.
 *
 * These tests pin the refusal. They are written on the shapes the field row
 * actually has: a direction with a POOL of two (one gone, one alive), and a
 * direction with a single node that is gone.
 */
const ENTRY = 'e1111111-1111-1111-1111-111111111111';
const ALIVE = 'a2222222-2222-2222-2222-222222222222';
const GONE = 'd0b08fe3-3333-3333-3333-333333333333';

function poolLinks(): TopologyLinkRow[] {
  return [
    {
      fromNodeId: ENTRY,
      toNodeId: ALIVE,
      directionTag: 1,
      cred: { protocol: 'vless', port: 24000, uuid: 'u-alive' },
    },
    {
      fromNodeId: ENTRY,
      toNodeId: GONE,
      directionTag: 1,
      cred: { protocol: 'vless', port: 24000, uuid: 'u-gone' },
    },
  ];
}

const hostsWithout = (...ids: string[]) =>
  new Map(
    [
      [ENTRY, 'entry.example.com'],
      [ALIVE, 'alive.example.com'],
      [GONE, 'gone.example.com'],
    ].filter(([id]) => !ids.includes(id as string)) as [string, string][],
  );

describe('a direction pointing at a node that is gone', () => {
  it('refuses instead of quietly shrinking the pool', () => {
    // The old outcome: two link-outs became one and the rule flipped from
    // `balancerTag` to a fixed `outboundTag`. The pool stopped being a pool and
    // nothing in the config said so.
    expect(() =>
      buildTopologyFragmentsForNode(ENTRY, {
        positions: [{ position: 0, nodeIds: [ENTRY] }],
        directions: [{ tag: 1, nodeIds: [ALIVE, GONE] }],
        links: poolLinks(),
        hosts: hostsWithout(GONE),
      }),
    ).toThrow(CascadeTopologyBrokenError);
  });

  it('names the node and the direction, so the operator can find it', () => {
    expect(() =>
      buildTopologyFragmentsForNode(ENTRY, {
        positions: [{ position: 0, nodeIds: [ENTRY] }],
        directions: [{ tag: 1, nodeIds: [ALIVE, GONE] }],
        links: poolLinks(),
        hosts: hostsWithout(GONE),
      }),
    ).toThrow(new RegExp(`${GONE}`));
  });

  it('refuses when the direction loses its only node', () => {
    // The worst of the three: no outbound AND no routing rule for that
    // direction, and a v4 entry has no catch-all, so the client falls through to
    // `freedom` and leaves from the entry country.
    expect(() =>
      buildTopologyFragmentsForNode(ENTRY, {
        positions: [{ position: 0, nodeIds: [ENTRY] }],
        directions: [{ tag: 1, nodeIds: [GONE] }],
        links: [poolLinks()[1]!],
        hosts: hostsWithout(GONE, ALIVE),
      }),
    ).toThrow(CascadeTopologyBrokenError);
  });

  it('refuses when a link ARRIVES from a node with no address', () => {
    // The allow-list would come out empty, and an empty allow-list makes the
    // agent open the link port to anyone.
    expect(() =>
      buildTopologyFragmentsForNode(ALIVE, {
        positions: [{ position: 0, nodeIds: [ENTRY] }],
        directions: [{ tag: 1, nodeIds: [ALIVE] }],
        links: [
          {
            fromNodeId: GONE,
            toNodeId: ALIVE,
            directionTag: 1,
            cred: { protocol: 'vless', port: 24000, uuid: 'u-in' },
          },
        ],
        hosts: hostsWithout(GONE),
      }),
    ).toThrow(CascadeTopologyBrokenError);
  });

  it('builds normally while every node is still there', () => {
    const out = buildTopologyFragmentsForNode(ENTRY, {
      positions: [{ position: 0, nodeIds: [ENTRY] }],
      directions: [{ tag: 1, nodeIds: [ALIVE, GONE] }],
      links: poolLinks(),
      hosts: hostsWithout(),
    });
    expect(out?.outbounds).toHaveLength(3); // two link-outs plus freedom
    expect(out?.balancers?.[0]?.tag).toBe('bal-d1');
  });
});
