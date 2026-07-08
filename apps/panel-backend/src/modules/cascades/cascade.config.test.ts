import { describe, expect, it } from 'vitest';
import {
  generateLinkCreds,
  buildCascadeConfigs,
  buildBalancerCascadeConfigs,
  normalizeLinkProtocol,
  serializeLinkCred,
  parseLinkCred,
  LINK_PORT_BASE,
  type CascadeConfigHopInput,
  type LinkCred,
} from './cascade.config.js';

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
    // QUIC (udp/443) is dropped first so clients fall back to TCP; the user
    // rule then targets the balancer, not a fixed outbound
    expect(e.routingRules[0]).toMatchObject({ network: 'udp', port: 443, outboundTag: 'blocked' });
    expect(e.routingRules[1]).toMatchObject({ balancerTag: 'auto' });
    expect(e.routingRules[1]).not.toHaveProperty('outboundTag');
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

describe('normalizeLinkProtocol', () => {
  it('maps shadowsocks to itself, everything else to the vless fallback', () => {
    expect(normalizeLinkProtocol('shadowsocks')).toBe('shadowsocks');
    expect(normalizeLinkProtocol('vless')).toBe('vless');
    expect(normalizeLinkProtocol('amneziawg')).toBe('vless'); // deferred cell -> vless
    expect(normalizeLinkProtocol(null)).toBe('vless');
    expect(normalizeLinkProtocol(undefined)).toBe('vless');
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
