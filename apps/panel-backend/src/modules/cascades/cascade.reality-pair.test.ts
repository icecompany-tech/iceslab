import { describe, expect, it } from 'vitest';
import { buildCascadeConfigs, buildTopologyFragmentsForNode, type LinkCred } from './cascade.config.js';

/**
 * The two ends of a REALITY leg on the XRAY renderers, checked against each
 * other, with no engine in the room.
 *
 * The chain (sing-box) has its own file; this one covers the two xray paths a
 * node can still be configured through:
 *
 *   - the v4 fragments, which every current cascade uses;
 *   - `buildCascadeConfigs`, the per-hop path a cascade written before the
 *     topology tables still renders through. The transitional fleet is exactly
 *     the reason it is not deleted, and exactly the reason it has to agree with
 *     itself here too.
 *
 * ⚠ No binary, on purpose, and not as a substitute for one. `xray -test` and
 * `sing-box check` answer "will it load", which both ends pass while holding
 * keys that do not match: that is how the 2026-08 hardening shipped, was
 * tested, and never carried a packet. What is asserted here is AGREEMENT, and
 * the engine tests sit beside it in cascade.xray-accepts.test.ts.
 */
const N = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const NODE_KEY = {
  privateKey: Buffer.alloc(32, 7).toString('base64url'),
  publicKey: Buffer.alloc(32, 9).toString('base64url'),
  serverName: 'www.microsoft.com',
  dest: 'www.microsoft.com:443',
};

const ENTRY = N(1);
const ENTRY_B = N(2);
const EXIT = N(3);
const hosts = new Map([
  [ENTRY, 'ru-a.example'],
  [ENTRY_B, 'ru-b.example'],
  [EXIT, 'nl.example'],
]);

const credFor = (n: number, shortId: string): LinkCred => ({
  protocol: 'vless',
  port: 24000,
  uuid: N(n),
  reality: { ...NODE_KEY, shortId },
});

interface XrayInbound {
  settings: { clients: { id: string; flow?: string }[] };
  streamSettings: {
    security?: string;
    realitySettings?: { privateKey: string; shortIds: string[]; serverNames: string[]; dest: string };
  };
}

interface XrayOutbound {
  settings: { vnext: { users: { id: string; flow?: string }[] }[] };
  streamSettings: {
    security?: string;
    realitySettings?: { publicKey: string; shortId: string; serverName: string; fingerprint: string };
  };
  mux?: unknown;
}

describe('the xray v4 fragments of a REALITY leg', () => {
  // A pool on the entry: two legs, one listener. The only shape that puts two
  // credentials on one xray inbound, and the one the old renderer ignored.
  const topology = {
    positions: [{ position: 0, nodeIds: [ENTRY, ENTRY_B] }],
    directions: [{ tag: 1, nodeIds: [EXIT] }],
    links: [
      { fromNodeId: ENTRY, toNodeId: EXIT, directionTag: 1, cred: credFor(5, '0123abcd') },
      { fromNodeId: ENTRY_B, toNodeId: EXIT, directionTag: 1, cred: credFor(6, '89ab0000') },
    ],
    hosts,
    policies: [],
  };

  const listener = buildTopologyFragmentsForNode(EXIT, topology)!.inbounds[0] as unknown as XrayInbound;
  const diallers = [ENTRY, ENTRY_B].map(
    (n) =>
      buildTopologyFragmentsForNode(n, topology)!.outbounds.find(
        (o) => (o as { protocol?: string }).protocol === 'vless',
      ) as unknown as XrayOutbound,
  );

  it('wraps the listener in REALITY at all, which it did not until 5b', () => {
    // `security: 'none'` was hardcoded here while the dialling side switched
    // itself on per credential. One line, and it made the pair impossible.
    expect(listener.streamSettings.security).toBe('reality');
    expect(listener.streamSettings.realitySettings!.privateKey).toBe(NODE_KEY.privateKey);
  });

  it('lists every arriving short id, not the first', () => {
    expect(listener.streamSettings.realitySettings!.shortIds.sort()).toEqual([
      '0123abcd',
      '89ab0000',
    ]);
  });

  it('is agreed on by every dialler: key, short id, name and target', () => {
    for (const out of diallers) {
      expect(out.streamSettings.security).toBe('reality');
      expect(out.streamSettings.realitySettings!.publicKey).toBe(NODE_KEY.publicKey);
      expect(listener.streamSettings.realitySettings!.shortIds).toContain(
        out.streamSettings.realitySettings!.shortId,
      );
      expect(listener.streamSettings.realitySettings!.serverNames).toContain(
        out.streamSettings.realitySettings!.serverName,
      );
    }
    expect(listener.streamSettings.realitySettings!.dest).toBe(NODE_KEY.dest);
  });

  it('names VISION on both ends and drops mux, which xray refuses beside it', () => {
    for (const c of listener.settings.clients) expect(c.flow).toBe('xtls-rprx-vision');
    for (const out of diallers) {
      expect(out.settings.vnext[0]!.users[0]!.flow).toBe('xtls-rprx-vision');
      expect(out.mux).toBeUndefined();
    }
  });

  it('leaves a leg with no block plain on both ends', () => {
    // The transitional state, and it has to stay symmetric too: a stored cred
    // from before 5b makes a plain pair, not a half-wrapped one.
    const plain = {
      ...topology,
      links: [
        {
          fromNodeId: ENTRY,
          toNodeId: EXIT,
          directionTag: 1,
          cred: { protocol: 'vless' as const, port: 24000, uuid: N(7) },
        },
      ],
      positions: [{ position: 0, nodeIds: [ENTRY] }],
    };
    const inbound = buildTopologyFragmentsForNode(EXIT, plain)!.inbounds[0] as unknown as XrayInbound;
    const outbound = buildTopologyFragmentsForNode(ENTRY, plain)!.outbounds.find(
      (o) => (o as { protocol?: string }).protocol === 'vless',
    ) as unknown as XrayOutbound;
    expect(inbound.streamSettings.security).toBe('none');
    expect(outbound.streamSettings.security).toBe('none');
    expect(inbound.settings.clients[0]!.flow).toBeUndefined();
    expect(outbound.settings.vnext[0]!.users[0]!.flow).toBeUndefined();
    // And mux comes BACK when there is no VISION to be exclusive with.
    expect(outbound.mux).toBeDefined();
  });
});

describe('the per-hop xray path, which the transitional fleet still renders', () => {
  /**
   * One credential, two hops, and the pair has to match across them: the cred on
   * hop[i] is dialled by hop[i] and listened on by hop[i+1]. A cascade written
   * before the topology tables renders only through here, and since 5b its
   * credential carries a block too, so the agreement matters on this path as
   * much as on the new one.
   */
  const cred = credFor(8, 'abcd0123');
  const configs = buildCascadeConfigs(
    [
      { nodeId: ENTRY, position: 0, nodeHost: 'ru-a.example', linkProtocol: 'vless' },
      { nodeId: EXIT, position: 1, nodeHost: 'nl.example' },
    ],
    [cred],
  );

  it('dials and listens with the two halves of the same block', () => {
    const outbound = configs[0]!.outbounds.find(
      (o) => (o as { protocol?: string }).protocol === 'vless',
    ) as unknown as XrayOutbound;
    const inbound = configs[1]!.inbounds[0] as unknown as XrayInbound;

    expect(outbound.streamSettings.realitySettings!.publicKey).toBe(NODE_KEY.publicKey);
    expect(inbound.streamSettings.realitySettings!.privateKey).toBe(NODE_KEY.privateKey);
    expect(inbound.streamSettings.realitySettings!.shortIds).toContain(
      outbound.streamSettings.realitySettings!.shortId,
    );
    expect(inbound.settings.clients[0]!.flow).toBe('xtls-rprx-vision');
    expect(outbound.settings.vnext[0]!.users[0]!.flow).toBe('xtls-rprx-vision');
  });
});
