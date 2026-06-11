import { describe, expect, it } from 'vitest';
import { buildXrayJson } from './xrayjson.js';
import type { SubscriptionEndpoint } from '../subscription.formats.js';

const xrayEp: SubscriptionEndpoint = {
  protocol: 'xray',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  uuid: '11111111-2222-3333-4444-555555555555',
  publicKey: 'pubkey-base64url',
  shortId: 'abc123',
  sni: 'www.cloudflare.com',
  flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
  uri: 'vless://...',
};

const hysteriaEp: SubscriptionEndpoint = {
  protocol: 'hysteria',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  password: 'hy',
  uri: 'hysteria2://...',
};

function parse(out: string) {
  return JSON.parse(out);
}

describe('buildXrayJson', () => {
  it('produces valid JSON with trailing newline', () => {
    const out = buildXrayJson([xrayEp]);
    expect(out.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('emits a SOCKS5 inbound on 127.0.0.1:10808 with udp enabled', () => {
    const cfg = parse(buildXrayJson([xrayEp]));
    expect(cfg.inbounds).toHaveLength(1);
    expect(cfg.inbounds[0].protocol).toBe('socks');
    expect(cfg.inbounds[0].port).toBe(10808);
    expect(cfg.inbounds[0].listen).toBe('127.0.0.1');
    expect(cfg.inbounds[0].settings.udp).toBe(true);
  });

  it('emits a vless+REALITY outbound with v24.9.30 raw network', () => {
    const cfg = parse(buildXrayJson([xrayEp]));
    const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
    expect(v.tag).toBe('eu-1-xray');
    const user = v.settings.vnext[0].users[0];
    expect(user.id).toBe('11111111-2222-3333-4444-555555555555');
    expect(user.flow).toBe('xtls-rprx-vision');
    expect(user.encryption).toBe('none');
    expect(v.streamSettings.network).toBe('raw');
    expect(v.streamSettings.security).toBe('reality');
    expect(v.streamSettings.realitySettings.publicKey).toBe('pubkey-base64url');
    expect(v.streamSettings.realitySettings.shortId).toBe('abc123');
    expect(v.streamSettings.realitySettings.serverName).toBe('www.cloudflare.com');
    expect(v.streamSettings.realitySettings.fingerprint).toBe('chrome');
  });

  it('emits a vmess outbound (security auto, alterId 0) with no reality', () => {
    const cfg = parse(
      buildXrayJson([
        { ...xrayEp, subprotocol: 'vmess', securityLayer: 'none', network: 'ws', flow: undefined },
      ]),
    );
    const v = cfg.outbounds.find((o: any) => o.protocol === 'vmess');
    expect(v).toBeDefined();
    const user = v.settings.vnext[0].users[0];
    expect(user.id).toBe('11111111-2222-3333-4444-555555555555');
    expect(user.security).toBe('auto');
    expect(user.alterId).toBe(0);
    expect(v.streamSettings.security).toBe('none');
    expect(v.streamSettings.realitySettings).toBeUndefined();
  });

  it('emits a trojan outbound (servers/password), not a vless one', () => {
    const cfg = parse(buildXrayJson([{ ...xrayEp, subprotocol: 'trojan' }]));
    const t = cfg.outbounds.find((o: any) => o.protocol === 'trojan');
    expect(t).toBeDefined();
    expect(t.settings.servers[0].password).toBe('11111111-2222-3333-4444-555555555555');
    expect(cfg.outbounds.find((o: any) => o.protocol === 'vless')).toBeUndefined();
  });

  it('security tls emits tlsSettings, not realitySettings', () => {
    const cfg = parse(buildXrayJson([{ ...xrayEp, securityLayer: 'tls' }]));
    const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
    expect(v.streamSettings.security).toBe('tls');
    expect(v.streamSettings.tlsSettings.serverName).toBe('www.cloudflare.com');
    expect(v.streamSettings.realitySettings).toBeUndefined();
  });

  it('always includes freedom (direct) and blackhole (block) outbounds', () => {
    const cfg = parse(buildXrayJson([xrayEp]));
    expect(cfg.outbounds.find((o: any) => o.protocol === 'freedom')).toBeDefined();
    expect(cfg.outbounds.find((o: any) => o.protocol === 'blackhole')).toBeDefined();
  });

  it('sets a catch-all route to the first proxy when xray endpoints exist', () => {
    const second: SubscriptionEndpoint = { ...xrayEp, nodeName: 'us-1' };
    const cfg = parse(buildXrayJson([xrayEp, second]));
    expect(cfg.routing.rules[0].outboundTag).toBe('eu-1-xray');
    expect(cfg.routing.rules[0].network).toBe('tcp,udp');
  });

  it('falls back to routing through direct when no xray endpoint is present', () => {
    const cfg = parse(buildXrayJson([hysteriaEp]));
    expect(cfg.routing.rules[0].outboundTag).toBe('direct');
    // No vless outbound emitted.
    expect(cfg.outbounds.find((o: any) => o.protocol === 'vless')).toBeUndefined();
  });

  it('skips non-xray endpoints silently', () => {
    const out = buildXrayJson([hysteriaEp, xrayEp]);
    expect(out).not.toContain('hy-secret');
    expect(out).not.toContain('hysteria2');
    expect(out).toContain('eu-1-xray');
  });

  it('output is byte-deterministic for the same input', () => {
    expect(buildXrayJson([xrayEp])).toBe(buildXrayJson([xrayEp]));
  });

  // Routing Templates (R1a).
  describe('routingPreset', () => {
    it('default proxy-all output is byte-identical to pre-R1 (no preset rules, AsIs)', () => {
      expect(buildXrayJson([xrayEp], { routingPreset: 'proxy-all' })).toBe(
        buildXrayJson([xrayEp]),
      );
      const cfg = parse(buildXrayJson([xrayEp]));
      expect(cfg.routing.domainStrategy).toBe('AsIs');
      expect(cfg.routing.rules).toHaveLength(1);
      expect(JSON.stringify(cfg.routing.rules)).not.toContain('geosite');
    });

    it('ru-split prepends block/direct rules ahead of the catch-all', () => {
      const cfg = parse(buildXrayJson([xrayEp], { routingPreset: 'ru-split' }));
      const rules = cfg.routing.rules;
      expect(rules).toHaveLength(4);
      expect(rules[0].domain).toEqual(['geosite:category-ads-all']);
      expect(rules[0].outboundTag).toBe('block');
      expect(rules[1].domain).toEqual([
        'geosite:category-ru',
        'geosite:category-gov-ru',
      ]);
      expect(rules[1].outboundTag).toBe('direct');
      expect(rules[2].ip).toEqual(['geoip:private', 'geoip:ru']);
      expect(rules[2].outboundTag).toBe('direct');
      // Catch-all stays last so unmatched traffic still tunnels.
      expect(rules[3].network).toBe('tcp,udp');
      expect(rules[3].outboundTag).toBe('eu-1-xray');
    });

    it('ru-split switches domainStrategy to IPIfNonMatch', () => {
      const cfg = parse(buildXrayJson([xrayEp], { routingPreset: 'ru-split' }));
      expect(cfg.routing.domainStrategy).toBe('IPIfNonMatch');
    });

    it('ru-split composes with bundle=balancer (preset rules first, balancer catch-all last)', () => {
      const second: SubscriptionEndpoint = { ...xrayEp, nodeName: 'us-1' };
      const cfg = parse(
        buildXrayJson([xrayEp, second], {
          bundle: 'balancer',
          routingPreset: 'ru-split',
        }),
      );
      const rules = cfg.routing.rules;
      expect(rules).toHaveLength(4);
      expect(rules[3].balancerTag).toBe('balancer-auto');
      expect(cfg.observatory).toBeDefined();
    });
  });
});
