import { describe, expect, it } from 'vitest';
import {
  generateLinkCreds,
  buildCascadeConfigs,
  normalizeLinkProtocol,
  serializeLinkCred,
  parseLinkCred,
  LINK_PORT_BASE,
  type CascadeConfigHopInput,
  type LinkCred,
} from './cascade.config.js';

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
    expect(cfg.routingRules[0]!.outboundTag).toBe('cascade-link-out');
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
    // routing roles are protocol-agnostic
    expect(entry!.routingRules[0]!.outboundTag).toBe('cascade-link-out');
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
