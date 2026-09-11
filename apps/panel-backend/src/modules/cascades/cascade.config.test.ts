import { describe, expect, it } from 'vitest';
import {
  generateLinkCreds,
  buildCascadeConfigs,
  buildBalancerCascadeConfigs,
  linkCellFor,
  normalizeLinkProtocol,
  serializeLinkCred,
  parseLinkCred,
  LINK_PORT_BASE,
  type CascadeConfigHopInput,
  type LinkCred,
} from './cascade.config.js';

// Regression cover for the prod defect found 2026-07-29: ad-split policies
// reached balancer entries only, so on a chain an operator could define a
// policy, grant it, see the panel report success, and get no rules on the node.
describe('buildCascadeConfigs (chain) ad-split', () => {
  const hops: CascadeConfigHopInput[] = [
    { nodeId: 'n-entry', position: 0, nodeHost: 'entry.example.com' },
    { nodeId: 'n-exit', position: 1, nodeHost: 'exit.example.com' },
  ];
  const creds: LinkCred[] = [{ protocol: 'vless', port: 24000, uuid: 'u-0' }];
  const noAds = {
    ordinal: 1,
    directDomains: ['geosite:ru'],
    blockDomains: ['geosite:category-ads-all'],
  };

  it('without policies the entry rules are unchanged: QUIC drop then catch-all', () => {
    const entryRules = buildCascadeConfigs(hops, creds)[0]!.routingRules;
    expect(entryRules).toHaveLength(2);
    expect(entryRules[0]).toMatchObject({ network: 'udp', port: 443, outboundTag: 'blocked' });
    expect(entryRules[1]).toMatchObject({ network: 'tcp,udp', outboundTag: 'cascade-link-out' });
    expect(entryRules.some((r) => 'vlessRoute' in r)).toBe(false);
  });

  it('a granted policy lands on the chain entry, tagged and above the catch-all', () => {
    const entryRules = buildCascadeConfigs(hops, creds, [noAds])[0]!.routingRules;
    // ordinal 1, exitIndex 0 -> 1*256 + 0 + 1
    const tag = String(257);
    const block = entryRules.findIndex((r) => r.outboundTag === 'blocked' && 'domain' in r);
    const direct = entryRules.findIndex((r) => r.outboundTag === 'direct');
    const catchAll = entryRules.findIndex(
      (r) => r.outboundTag === 'cascade-link-out' && !('vlessRoute' in r),
    );
    expect(entryRules[block]).toMatchObject({
      vlessRoute: tag,
      domain: ['geosite:category-ads-all'],
    });
    expect(entryRules[direct]).toMatchObject({ vlessRoute: tag, domain: ['geosite:ru'] });
    // Order is the whole point: a split rule below the catch-all never fires.
    expect(block).toBeLessThan(catchAll);
    expect(direct).toBeLessThan(catchAll);
  });

  it('emits no rule for the plain profile: one exit means nothing to select', () => {
    const entryRules = buildCascadeConfigs(hops, creds, [noAds])[0]!.routingRules;
    // routeTag(0, 0) = 1 would be the plain tag; an untagged client and a plain
    // one both fall through to the same catch-all, so a rule would be noise.
    expect(entryRules.some((r) => r.vlessRoute === '1')).toBe(false);
  });

  it('leaves transit and exit hops alone', () => {
    const cfgs = buildCascadeConfigs(
      [...hops, { nodeId: 'n-transit', position: 2, nodeHost: 'transit.example.com' }],
      [...creds, { protocol: 'vless', port: 24001, uuid: 'u-1' }],
      [noAds],
    );
    for (const c of cfgs.slice(1)) {
      expect(c.routingRules.some((r) => 'vlessRoute' in r)).toBe(false);
    }
  });
});

// The inter-hop link is the LONGEST leg of a cascade, and until 2026-07-30 it
// was the only outbound with no socket tuning at all: the node's own `direct`
// has carried BBR since slice 23.1. Reported from the field as pages loading
// heavily while raw throughput looked fine.
describe('inter-hop link tuning', () => {
  // Deliberately unnamed by geography: this applies to every link between two
  // hops, whatever the countries. The field report happened to be RU to NL,
  // but the tuning is not about that pair.
  const hops: CascadeConfigHopInput[] = [
    { nodeId: 'n-entry', position: 0, nodeHost: 'entry.example.com' },
    { nodeId: 'n-exit', position: 1, nodeHost: 'exit.example.com' },
  ];

  function linkOut(cred: LinkCred) {
    const entry = buildCascadeConfigs(hops, [cred])[0]!;
    return entry.outbounds.find((o) => o.tag === 'cascade-link-out')!;
  }

  it.each([
    ['vless', { protocol: 'vless', port: 24000, uuid: 'u-0' } as LinkCred],
    [
      'shadowsocks',
      { protocol: 'shadowsocks', port: 24000, psk: 'p', method: '2022-blake3-aes-256-gcm' } as LinkCred,
    ],
  ])('%s link runs BBR with fast open', (_name, cred) => {
    const out = linkOut(cred);
    const ss = out.streamSettings as Record<string, unknown>;
    expect(ss.sockopt).toMatchObject({ tcpCongestion: 'bbr', tcpFastOpen: true });
  });

  it.each([
    ['vless', { protocol: 'vless', port: 24000, uuid: 'u-0' } as LinkCred],
    [
      'shadowsocks',
      { protocol: 'shadowsocks', port: 24000, psk: 'p', method: '2022-blake3-aes-256-gcm' } as LinkCred,
    ],
  ])('%s link multiplexes so a page does not pay a round trip per request', (_name, cred) => {
    expect(linkOut(cred).mux).toMatchObject({ enabled: true, concurrency: 8 });
  });

  it('leaves the exit egress alone: only the link between hops is tuned', () => {
    const cfgs = buildCascadeConfigs(hops, [{ protocol: 'vless', port: 24000, uuid: 'u-0' }]);
    const exitDirect = cfgs[1]!.outbounds.find((o) => o.tag === 'direct')!;
    // The node's base config already owns `direct`; duplicating tuning here
    // would be a second opinion on a tag we do not control.
    expect(exitDirect).not.toHaveProperty('mux');
  });
});

describe('buildBalancerCascadeConfigs (auto node)', () => {
  const entry: CascadeConfigHopInput = { nodeId: 'n-entry', position: 0, nodeHost: 'ru.example.com' };
  const exits: CascadeConfigHopInput[] = [
    { nodeId: 'n-de', position: 1, nodeHost: 'de.example.com' },
    { nodeId: 'n-nl', position: 2, nodeHost: 'nl.example.com' },
  ];
  const creds: LinkCred[] = [
    { protocol: 'vless', port: 24000, uuid: 'uuid-de' },
    { protocol: 'vless', port: 24001, uuid: 'uuid-nl' },
  ];

  it('emits 1 entry + N exits; the entry carries observatory + balancer', () => {
    const cfgs = buildBalancerCascadeConfigs(entry, exits, creds);
    expect(cfgs).toHaveLength(3);
    const e = cfgs[0]!;
    expect(e.role).toBe('entry');
    // one link-out per exit (+ freedom), all sharing the cascade-link-out prefix
    const outTags = e.outbounds.map((o) => o.tag);
    expect(outTags).toContain('cascade-link-out-0');
    expect(outTags).toContain('cascade-link-out-1');
    expect(outTags).toContain('direct');
    // observatory probes the link-out prefix (probeURL, not probeUrl: xray json tag)
    const obs = e.observatory as Record<string, unknown>;
    expect(obs.subjectSelector).toEqual(['cascade-link-out']);
    expect(obs.probeURL).toBe('https://www.gstatic.com/generate_204');
    expect(obs).not.toHaveProperty('probeUrl');
    // balancer selects the same prefix via leastPing (consumes the observatory)
    const bal = (e.balancers as Record<string, unknown>[])[0]!;
    expect(bal.tag).toBe('auto');
    expect(bal.selector).toEqual(['cascade-link-out']);
    expect((bal.strategy as Record<string, unknown>).type).toBe('leastPing');
    // QUIC (udp/443) is dropped first so clients fall back to TCP; then the A4
    // explicit-exit vlessRoute rules (one per exit); the untagged catch-all
    // targets the balancer LAST so a normal UUID auto-balances.
    expect(e.routingRules[0]).toMatchObject({ network: 'udp', port: 443, outboundTag: 'blocked' });
    const last = e.routingRules[e.routingRules.length - 1]!;
    expect(last).toMatchObject({ balancerTag: 'auto' });
    expect(last).not.toHaveProperty('outboundTag');
  });

  it('A4: one vlessRoute rule per exit, tag i+1 -> cascade-link-out-i, above the balancer', () => {
    const cfgs = buildBalancerCascadeConfigs(entry, exits, creds);
    const rules = cfgs[0]!.routingRules;
    // [0]=QUIC block, [1..N]=vlessRoute per exit, [last]=balancer
    expect(rules[1]).toMatchObject({
      vlessRoute: '1',
      network: 'tcp,udp',
      outboundTag: 'cascade-link-out-0',
    });
    expect(rules[2]).toMatchObject({
      vlessRoute: '2',
      network: 'tcp,udp',
      outboundTag: 'cascade-link-out-1',
    });
    // tag value is a string (xray port-like syntax); 0 is never emitted so the
    // untagged/auto config can't collide with an explicit exit.
    const tags = rules.filter((r) => 'vlessRoute' in r).map((r) => r.vlessRoute);
    expect(tags).toEqual(['1', '2']);
    // every vlessRoute rule sits before the balancer catch-all
    const balIdx = rules.findIndex((r) => 'balancerTag' in r);
    const lastVlessIdx = rules.map((r) => 'vlessRoute' in r).lastIndexOf(true);
    expect(lastVlessIdx).toBeLessThan(balIdx);
  });

  it('A4 ad-split: a policy (ordinal 1) emits block/direct rules above the exit-catch-all in its tag band', () => {
    const policies = [
      { ordinal: 1, directDomains: ['geosite:google'], blockDomains: ['geosite:category-ads-all'] },
    ];
    const rules = buildBalancerCascadeConfigs(entry, exits, creds, policies)[0]!.routingRules;
    // Plain tags 1,2 still present for both exits.
    const plainTags = rules.filter((r) => 'network' in r && 'vlessRoute' in r).map((r) => r.vlessRoute);
    expect(plainTags).toEqual(expect.arrayContaining(['1', '2', '257', '258']));
    // Policy band = ordinal*256 + i + 1 -> exit 0 = 257, exit 1 = 258.
    const band = rules.filter((r) => r.vlessRoute === '257');
    // block (ads) then direct (google) then the exit-catch-all, in that order.
    expect(band[0]).toMatchObject({ vlessRoute: '257', domain: ['geosite:category-ads-all'], outboundTag: 'blocked' });
    expect(band[1]).toMatchObject({ vlessRoute: '257', domain: ['geosite:google'], outboundTag: 'direct' });
    expect(band[2]).toMatchObject({ vlessRoute: '257', network: 'tcp,udp', outboundTag: 'cascade-link-out-0' });
    // The block/direct rules sit ABOVE the exit-catch-all for that tag.
    const idxBlock = rules.findIndex((r) => r.vlessRoute === '257' && r.outboundTag === 'blocked');
    const idxExit = rules.findIndex((r) => r.vlessRoute === '257' && r.outboundTag === 'cascade-link-out-0');
    expect(idxBlock).toBeLessThan(idxExit);
    // Still ends on the balancer catch-all.
    expect(rules[rules.length - 1]).toMatchObject({ balancerTag: 'auto' });
  });

  it('each exit terminates its link and egresses via freedom, firewalled to the entry', () => {
    const cfgs = buildBalancerCascadeConfigs(entry, exits, creds);
    const de = cfgs[1]!;
    expect(de.role).toBe('exit');
    expect(de.inbounds[0]).toMatchObject({ tag: 'cascade-link-in', port: 24000 });
    expect(de.routingRules[0]).toMatchObject({ outboundTag: 'direct' });
    expect(de.linkIngressPort).toBe(24000);
    expect(de.linkAllowFrom).toEqual(['ru.example.com']);
    expect(cfgs[2]!.linkIngressPort).toBe(24001);
  });

  it('does not leak the entry observatory/balancer onto exit hops', () => {
    const cfgs = buildBalancerCascadeConfigs(entry, exits, creds);
    expect(cfgs[1]!.observatory).toBeUndefined();
    expect(cfgs[1]!.balancers).toBeUndefined();
  });
});

describe('generateLinkCreds', () => {
  it('makes one cred per link, sequential ports, vless by default', () => {
    const creds = generateLinkCreds(['vless', 'vless']);
    expect(creds).toHaveLength(2);
    expect(creds[0]!.port).toBe(LINK_PORT_BASE);
    expect(creds[1]!.port).toBe(LINK_PORT_BASE + 1);
    expect(creds[0]!.protocol).toBe('vless');
    if (creds[0]!.protocol === 'vless' && creds[1]!.protocol === 'vless') {
      expect(creds[0]!.uuid).not.toBe(creds[1]!.uuid);
    }
  });
  it('a single link yields one cred, an empty list yields none', () => {
    expect(generateLinkCreds(['vless'])).toHaveLength(1);
    expect(generateLinkCreds([])).toHaveLength(0);
  });
  it('a shadowsocks link gets a 32-byte base64 PSK + SS2022 method, no uuid', () => {
    const [cred] = generateLinkCreds(['shadowsocks']);
    expect(cred!.protocol).toBe('shadowsocks');
    if (cred!.protocol === 'shadowsocks') {
      expect(cred!.method).toBe('2022-blake3-aes-256-gcm');
      // aes-256-gcm needs a 32-byte key; raw bytes round-trip from the base64.
      expect(Buffer.from(cred!.psk, 'base64')).toHaveLength(32);
    }
  });
});

describe('linkCellFor', () => {
  // The column holds an ENGINE name out of the seven-core enum; LinkProtocol
  // names the CELL that carries one hop to the next. The field's `ru` cascade
  // stores "xray" and has always been built as a vless link, so the mapping is
  // written down rather than left to "everything that is not shadowsocks".
  it('reads the engine name the field actually stores', () => {
    expect(linkCellFor('xray')).toBe('vless');
  });

  it('reads the cell named directly', () => {
    expect(linkCellFor('vless')).toBe('vless');
    expect(linkCellFor('shadowsocks')).toBe('shadowsocks');
  });

  it('treats nothing named as the default cell, not as a wrong name', () => {
    // A balancer exit carries no link protocol at all.
    expect(linkCellFor(null)).toBe('vless');
    expect(linkCellFor(undefined)).toBe('vless');
    expect(linkCellFor('')).toBe('vless');
  });

  it('answers null for a protocol no cell carries', () => {
    // It used to answer 'vless' here. The operator chose hysteria, the node
    // built a vless link, the panel kept showing hysteria, and the cascade
    // worked, which is exactly why nobody noticed.
    expect(linkCellFor('hysteria')).toBeNull();
    expect(linkCellFor('amneziawg')).toBeNull();
    expect(linkCellFor('naive')).toBeNull();
  });

  it('normalizeLinkProtocol refuses rather than substituting', () => {
    expect(normalizeLinkProtocol('xray')).toBe('vless');
    expect(() => normalizeLinkProtocol('hysteria')).toThrow(/hysteria/);
  });
});

describe('serializeLinkCred / parseLinkCred', () => {
  it('round-trips a vless cred', () => {
    const cred: LinkCred = { protocol: 'vless', port: 24000, uuid: 'u-0' };
    expect(parseLinkCred(serializeLinkCred(cred))).toEqual(cred);
  });
  it('round-trips a shadowsocks cred', () => {
    const cred: LinkCred = {
      protocol: 'shadowsocks',
      port: 24001,
      psk: 'cHNrLTA=',
      method: '2022-blake3-aes-256-gcm',
    };
    expect(parseLinkCred(serializeLinkCred(cred))).toEqual(cred);
  });
  it('reads a legacy linkConfig (no protocol field) as vless', () => {
    expect(parseLinkCred({ uuid: 'u-0', port: 24000 })).toEqual({
      protocol: 'vless',
      port: 24000,
      uuid: 'u-0',
    });
  });
  it('returns null on malformed creds', () => {
    expect(parseLinkCred(null)).toBeNull();
    expect(parseLinkCred({ port: 24000 })).toBeNull(); // vless missing uuid
    expect(parseLinkCred({ protocol: 'shadowsocks', port: 24000, psk: 'x' })).toBeNull(); // ss missing method
    expect(parseLinkCred({ protocol: 'vless', uuid: 'u' })).toBeNull(); // missing port
  });
});

describe('buildCascadeConfigs (vless->vless)', () => {
  const hops: CascadeConfigHopInput[] = [
    { nodeId: 'n0', position: 0, nodeHost: 'ru.example.com' },
    { nodeId: 'n1', position: 1, nodeHost: 'transit.example.com' },
    { nodeId: 'n2', position: 2, nodeHost: 'eu.example.com' },
  ];
  const creds: LinkCred[] = [
    { protocol: 'vless', uuid: 'uuid-0', port: 24000 },
    { protocol: 'vless', uuid: 'uuid-1', port: 24001 },
  ];

  it('entry has a link-out to the next hop + freedom, routes user traffic out', () => {
    const cfg = buildCascadeConfigs(hops, creds)[0]!;
    expect(cfg.role).toBe('entry');
    expect(cfg.inbounds).toEqual([]); // user inbound deployed via profile, not here
    const out = cfg.outbounds.find((o) => o.tag === 'cascade-link-out') as any;
    expect(out.settings.vnext[0].address).toBe('transit.example.com');
    expect(out.settings.vnext[0].port).toBe(24000);
    expect(out.settings.vnext[0].users[0].id).toBe('uuid-0');
    expect(cfg.outbounds.some((o) => o.protocol === 'freedom')).toBe(true);
    // [0] drops QUIC (udp/443), [1] sends the rest to the link-out
    expect(cfg.routingRules[0]).toMatchObject({ network: 'udp', port: 443, outboundTag: 'blocked' });
    expect(cfg.routingRules[1]!.outboundTag).toBe('cascade-link-out');
  });

  it('transit has link-in (from prev) + link-out (to next), routed through', () => {
    const cfg = buildCascadeConfigs(hops, creds)[1]!;
    expect(cfg.role).toBe('transit');
    const inb = cfg.inbounds[0] as any;
    expect(inb.port).toBe(24000); // listens on the link FROM the entry
    expect(inb.settings.clients[0].id).toBe('uuid-0');
    const out = cfg.outbounds.find((o) => o.tag === 'cascade-link-out') as any;
    expect(out.settings.vnext[0].address).toBe('eu.example.com');
    expect(out.settings.vnext[0].port).toBe(24001);
    expect(out.settings.vnext[0].users[0].id).toBe('uuid-1');
    expect(cfg.routingRules[0]).toMatchObject({ inboundTag: ['cascade-link-in'], outboundTag: 'cascade-link-out' });
  });

  it('exit has link-in + freedom only, routes link-in -> direct', () => {
    const cfg = buildCascadeConfigs(hops, creds)[2]!;
    expect(cfg.role).toBe('exit');
    const inb = cfg.inbounds[0] as any;
    expect(inb.port).toBe(24001); // listens on the link FROM the transit
    expect(inb.settings.clients[0].id).toBe('uuid-1');
    expect(cfg.outbounds.every((o) => o.tag !== 'cascade-link-out')).toBe(true);
    expect(cfg.outbounds.some((o) => o.protocol === 'freedom')).toBe(true);
    expect(cfg.routingRules[0]).toMatchObject({ inboundTag: ['cascade-link-in'], outboundTag: 'direct' });
  });

  it('a 2-hop cascade is entry -> exit with one link', () => {
    const two = buildCascadeConfigs(hops.slice(0, 2), creds.slice(0, 1));
    expect(two.map((h) => h.role)).toEqual(['entry', 'exit']);
    expect((two[1]!.inbounds[0] as any).port).toBe(24000);
  });

  it('exposes the link-in port + previous-hop address for the agent firewall', () => {
    const [entry, transit, exit] = buildCascadeConfigs(hops, creds);
    // entry has no link-in -> nothing for the agent to firewall
    expect(entry!.linkIngressPort).toBeUndefined();
    expect(entry!.linkAllowFrom).toBeUndefined();
    // transit listens on the entry's link, restricted to the entry's host
    expect(transit!.linkIngressPort).toBe(24000);
    expect(transit!.linkAllowFrom).toEqual(['ru.example.com']);
    // exit listens on the transit's link, restricted to the transit's host
    expect(exit!.linkIngressPort).toBe(24001);
    expect(exit!.linkAllowFrom).toEqual(['transit.example.com']);
  });
});

describe('buildCascadeConfigs (shadowsocks link cell, C3b)', () => {
  const hops: CascadeConfigHopInput[] = [
    { nodeId: 'n0', position: 0, nodeHost: 'ru.example.com' },
    { nodeId: 'n1', position: 1, nodeHost: 'eu.example.com' },
  ];
  const ssCreds: LinkCred[] = [
    { protocol: 'shadowsocks', port: 24000, psk: 'cHNrLTA=', method: '2022-blake3-aes-256-gcm' },
  ];

  it('entry dials an SS outbound; exit listens on a single-PSK SS inbound', () => {
    const [entry, exit] = buildCascadeConfigs(hops, ssCreds);
    const out = entry!.outbounds.find((o) => o.tag === 'cascade-link-out') as any;
    expect(out.protocol).toBe('shadowsocks');
    expect(out.settings.servers[0]).toMatchObject({
      address: 'eu.example.com',
      port: 24000,
      method: '2022-blake3-aes-256-gcm',
      password: 'cHNrLTA=',
    });
    const inb = exit!.inbounds[0] as any;
    expect(inb.protocol).toBe('shadowsocks');
    expect(inb.port).toBe(24000);
    expect(inb.settings).toMatchObject({
      method: '2022-blake3-aes-256-gcm',
      password: 'cHNrLTA=',
      network: 'tcp,udp',
    });
    expect(inb.settings.clients).toBeUndefined(); // point-to-point, no multi-user clients
    // routing roles are protocol-agnostic ([0] drops QUIC, [1] link-out)
    expect(entry!.routingRules[1]!.outboundTag).toBe('cascade-link-out');
    expect(exit!.routingRules[0]).toMatchObject({ inboundTag: ['cascade-link-in'], outboundTag: 'direct' });
  });

  it('mixes cell types per link (vless entry->transit, ss transit->exit)', () => {
    const threeHops: CascadeConfigHopInput[] = [
      { nodeId: 'n0', position: 0, nodeHost: 'ru.example.com' },
      { nodeId: 'n1', position: 1, nodeHost: 'transit.example.com' },
      { nodeId: 'n2', position: 2, nodeHost: 'eu.example.com' },
    ];
    const mixed: LinkCred[] = [
      { protocol: 'vless', port: 24000, uuid: 'u-0' },
      { protocol: 'shadowsocks', port: 24001, psk: 'cHNrLTE=', method: '2022-blake3-aes-256-gcm' },
    ];
    const [entry, transit, exit] = buildCascadeConfigs(threeHops, mixed);
    // entry -> transit link is vless
    expect((entry!.outbounds.find((o) => o.tag === 'cascade-link-out') as any).protocol).toBe('vless');
    expect((transit!.inbounds[0] as any).protocol).toBe('vless');
    // transit -> exit link is shadowsocks
    expect((transit!.outbounds.find((o) => o.tag === 'cascade-link-out') as any).protocol).toBe('shadowsocks');
    expect((exit!.inbounds[0] as any).protocol).toBe('shadowsocks');
  });
});
