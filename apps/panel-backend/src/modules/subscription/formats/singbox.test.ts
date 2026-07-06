import { describe, expect, it } from 'vitest';
import { buildSingboxJson } from './singbox.js';
import type { SubscriptionEndpoint } from '../subscription.formats.js';

const hysteriaEp: SubscriptionEndpoint = {
  protocol: 'hysteria',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  password: 'hy-secret',
  uri: 'hysteria2://...',
};

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
  network: 'raw',
  uri: 'vless://...',
};

// Slice 24c part 3a: Trojan subprotocol over the same REALITY stack.
const trojanEp: SubscriptionEndpoint = {
  ...xrayEp,
  subprotocol: 'trojan',
  uri: 'trojan://...',
};

// Slice 24d: Shadowsocks 2022.
const ssEp: SubscriptionEndpoint = {
  protocol: 'shadowsocks',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 8388,
  method: '2022-blake3-aes-256-gcm',
  password: 'cabc78ae-94e3-4a16-936a-133d059acfac',
  uri: 'ss://...',
};

// ShadowTLS v3: an ss outbound that detours through a shadowtls outbound.
const shadowtlsEp: SubscriptionEndpoint = {
  protocol: 'shadowtls',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  shadowtlsPassword: 'stls-user-pw',
  handshake: 'www.microsoft.com',
  ssMethod: '2022-blake3-aes-128-gcm',
  ssPassword: 'inner-ss-key',
  uri: '',
};

function parse(out: string): { inbounds: any[]; outbounds: any[]; route: any; log: any } {
  return JSON.parse(out);
}

describe('buildSingboxJson', () => {
  it('outputs valid JSON ending in a newline', () => {
    const out = buildSingboxJson([hysteriaEp]);
    expect(out.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('emits exactly one tun inbound and no listening proxy inbound (no localhost leak)', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    expect(cfg.inbounds).toHaveLength(1);
    expect(cfg.inbounds[0].type).toBe('tun');
    // Never a mixed/socks/http listener: that would open a localhost proxy port.
    expect(
      cfg.inbounds.some((i: any) => ['mixed', 'socks', 'http'].includes(i.type)),
    ).toBe(false);
  });

  it('emits a hysteria2 outbound with mandatory fields', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    const hy = cfg.outbounds.find((o: any) => o.type === 'hysteria2');
    expect(hy).toBeDefined();
    expect(hy.tag).toBe('eu-1-hysteria');
    expect(hy.server).toBe('n1.example.com');
    expect(hy.server_port).toBe(443);
    expect(hy.password).toBe('hy-secret');
  });

  it('emits a vless+REALITY outbound nested under tls', () => {
    const cfg = parse(buildSingboxJson([xrayEp]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v).toBeDefined();
    expect(v.uuid).toBe('11111111-2222-3333-4444-555555555555');
    expect(v.flow).toBe('xtls-rprx-vision');
    expect(v.tls.enabled).toBe(true);
    expect(v.tls.server_name).toBe('www.cloudflare.com');
    expect(v.tls.utls.fingerprint).toBe('chrome');
    expect(v.tls.reality.enabled).toBe(true);
    expect(v.tls.reality.public_key).toBe('pubkey-base64url');
    expect(v.tls.reality.short_id).toBe('abc123');
  });

  it('appends an Auto selector listing every proxy plus direct', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp, xrayEp]));
    const sel = cfg.outbounds.find((o: any) => o.type === 'selector');
    expect(sel.tag).toBe('Auto');
    expect(sel.outbounds).toEqual(['eu-1-hysteria', 'eu-1-xray', 'direct']);
    expect(sel.default).toBe('eu-1-hysteria');
  });

  it('always includes a direct outbound', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    expect(cfg.outbounds.find((o: any) => o.type === 'direct' && o.tag === 'direct')).toBeDefined();
  });

  it('routes everything through Auto via route.final', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    expect(cfg.route.final).toBe('Auto');
    expect(cfg.route.auto_detect_interface).toBe(true);
  });

  it('falls back to route.final = direct when no proxies are emitted', () => {
    const cfg = parse(buildSingboxJson([]));
    expect(cfg.route.final).toBe('direct');
    // No selector when empty.
    expect(cfg.outbounds.find((o: any) => o.type === 'selector')).toBeUndefined();
    // Just the direct outbound.
    expect(cfg.outbounds).toHaveLength(1);
  });

  it('output is byte-deterministic for the same input', () => {
    const a = buildSingboxJson([hysteriaEp, xrayEp]);
    const b = buildSingboxJson([hysteriaEp, xrayEp]);
    expect(a).toBe(b);
  });

  it('emits shadowtls: an ss outbound detouring through a shadowtls v3 outbound', () => {
    const cfg = parse(buildSingboxJson([shadowtlsEp]));
    // The selectable proxy is a shadowsocks outbound reached only via detour.
    const ss = cfg.outbounds.find(
      (o: any) => o.type === 'shadowsocks' && o.tag === 'eu-1-shadowtls',
    );
    expect(ss).toBeDefined();
    expect(ss.method).toBe('2022-blake3-aes-128-gcm');
    expect(ss.password).toBe('inner-ss-key');
    expect(ss.detour).toBe('eu-1-shadowtls-stls');
    expect(ss.server).toBeUndefined(); // reached via detour, not directly
    // Its dialer is a shadowtls v3 outbound fronting the real handshake host.
    const stls = cfg.outbounds.find((o: any) => o.type === 'shadowtls');
    expect(stls).toBeDefined();
    expect(stls.tag).toBe('eu-1-shadowtls-stls');
    expect(stls.server).toBe('n1.example.com');
    expect(stls.server_port).toBe(443);
    expect(stls.version).toBe(3);
    expect(stls.password).toBe('stls-user-pw');
    expect(stls.tls.enabled).toBe(true);
    expect(stls.tls.server_name).toBe('www.microsoft.com');
  });

  // ───── Slice 24c part 3a: Trojan subprotocol ─────

  it('emits a trojan outbound when subprotocol=trojan; UUID becomes password', () => {
    const cfg = parse(buildSingboxJson([trojanEp]));
    const t = cfg.outbounds.find((o: any) => o.type === 'trojan');
    expect(t).toBeDefined();
    expect(t.tag).toBe('eu-1-xray'); // tag is by protocol field, not subprotocol
    expect(t.password).toBe('11111111-2222-3333-4444-555555555555');
    expect(t.uuid).toBeUndefined(); // Trojan outbound MUST NOT carry uuid
    expect(t.flow).toBeUndefined(); // Vision flow only on VLESS
  });

  it('Trojan still nests REALITY tls.reality block', () => {
    const cfg = parse(buildSingboxJson([trojanEp]));
    const t = cfg.outbounds.find((o: any) => o.type === 'trojan');
    expect(t.tls.reality.enabled).toBe(true);
    expect(t.tls.reality.public_key).toBe('pubkey-base64url');
  });

  // ───── VMess + security modes (none / tls) ─────

  it('emits a vmess outbound (security auto, alter_id 0), no reality', () => {
    const cfg = parse(
      buildSingboxJson([
        { ...xrayEp, subprotocol: 'vmess', securityLayer: 'none', network: 'ws', flow: undefined },
      ]),
    );
    const v = cfg.outbounds.find((o: any) => o.type === 'vmess');
    expect(v).toBeDefined();
    expect(v.uuid).toBe('11111111-2222-3333-4444-555555555555');
    expect(v.security).toBe('auto');
    expect(v.alter_id).toBe(0);
    expect(v.tls).toBeUndefined(); // none = no TLS block
  });

  it('security none omits the tls block', () => {
    const cfg = parse(buildSingboxJson([{ ...xrayEp, securityLayer: 'none' }]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v.tls).toBeUndefined();
  });

  it('security tls emits a tls block without reality', () => {
    const cfg = parse(buildSingboxJson([{ ...xrayEp, securityLayer: 'tls' }]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v.tls.enabled).toBe(true);
    expect(v.tls.server_name).toBe('www.cloudflare.com');
    expect(v.tls.reality).toBeUndefined();
  });

  // ───── Slice 24d: Shadowsocks ─────

  it('emits a shadowsocks outbound with method+password and no TLS', () => {
    const cfg = parse(buildSingboxJson([ssEp]));
    const ss = cfg.outbounds.find((o: any) => o.type === 'shadowsocks');
    expect(ss).toBeDefined();
    expect(ss.tag).toBe('eu-1-shadowsocks');
    expect(ss.server).toBe('n1.example.com');
    expect(ss.server_port).toBe(8388);
    expect(ss.method).toBe('2022-blake3-aes-256-gcm');
    expect(ss.password).toBe('cabc78ae-94e3-4a16-936a-133d059acfac');
    // SS doesn't carry TLS, that field would confuse sing-box's parser
    expect(ss.tls).toBeUndefined();
  });

  it('mixed subscription emits all proxy types in the Auto selector', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp, xrayEp, trojanEp, ssEp]));
    const sel = cfg.outbounds.find((o: any) => o.type === 'selector');
    // Note: xrayEp and trojanEp share tag 'eu-1-xray' since both have
    // protocol='xray', only the subprotocol differs. In real subscriptions
    // they'd be on different ports/inbounds with unique nodeNames so tags
    // wouldn't actually collide.
    expect(sel.outbounds).toContain('eu-1-hysteria');
    expect(sel.outbounds).toContain('eu-1-xray');
    expect(sel.outbounds).toContain('eu-1-shadowsocks');
    expect(sel.outbounds).toContain('direct');
  });

  // ───── Slice 24c part 2: transport branches ─────

  it('emits ws transport block with path + Host header', () => {
    const wsEp = { ...xrayEp, network: 'ws' as const, path: '/api', hostHeader: 'cdn.example.com' };
    const cfg = parse(buildSingboxJson([wsEp]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v.transport.type).toBe('ws');
    expect(v.transport.path).toBe('/api');
    expect(v.transport.headers.Host).toBe('cdn.example.com');
  });

  it('emits httpupgrade transport block', () => {
    const huEp = { ...xrayEp, network: 'httpupgrade' as const, path: '/u', hostHeader: 'cdn.example.com' };
    const cfg = parse(buildSingboxJson([huEp]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v.transport.type).toBe('httpupgrade');
    expect(v.transport.path).toBe('/u');
    expect(v.transport.host).toBe('cdn.example.com');
  });

  it('emits grpc transport block with service_name', () => {
    const grpcEp = { ...xrayEp, network: 'grpc' as const, serviceName: 'GunSvc' };
    const cfg = parse(buildSingboxJson([grpcEp]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v.transport.type).toBe('grpc');
    expect(v.transport.service_name).toBe('GunSvc');
  });

  it('omits transport block on raw (REALITY canonical)', () => {
    const cfg = parse(buildSingboxJson([xrayEp])); // network: 'raw'
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v.transport).toBeUndefined();
  });

  // ───── Routing Templates (R1b) ─────

  describe('routingPreset', () => {
    it('default proxy-all output is byte-identical to pre-R1 (no rules / rule_set)', () => {
      expect(buildSingboxJson([xrayEp], { routingPreset: 'proxy-all' })).toBe(
        buildSingboxJson([xrayEp]),
      );
      const cfg = parse(buildSingboxJson([xrayEp]));
      expect(cfg.route.rules).toBeUndefined();
      expect(cfg.route.rule_set).toBeUndefined();
    });

    it('ru-split emits four remote binary rule-sets without download_detour', () => {
      const cfg = parse(buildSingboxJson([xrayEp], { routingPreset: 'ru-split' }));
      const sets = cfg.route.rule_set;
      expect(sets.map((s: any) => s.tag)).toEqual([
        'geosite-category-ads-all',
        'geosite-category-ru',
        'geosite-category-gov-ru',
        'geoip-ru',
      ]);
      for (const s of sets) {
        expect(s.type).toBe('remote');
        expect(s.format).toBe('binary');
        expect(s.url).toMatch(
          /^https:\/\/raw\.githubusercontent\.com\/SagerNet\/sing-(geosite|geoip)\/rule-set\/.+\.srs$/,
        );
        // Deprecated since sing-box 1.14 and redundant: until the rule-set
        // is downloaded its rules cannot match, so the fetch rides final.
        expect(s.download_detour).toBeUndefined();
      }
    });

    it('ru-split rules: reject ads, direct private IPs and RU, final stays Auto', () => {
      const cfg = parse(buildSingboxJson([xrayEp], { routingPreset: 'ru-split' }));
      const rules = cfg.route.rules;
      expect(rules).toHaveLength(3);
      expect(rules[0]).toEqual({
        rule_set: ['geosite-category-ads-all'],
        action: 'reject',
      });
      expect(rules[1]).toEqual({
        ip_is_private: true,
        action: 'route',
        outbound: 'direct',
      });
      expect(rules[2]).toEqual({
        rule_set: ['geosite-category-ru', 'geosite-category-gov-ru', 'geoip-ru'],
        action: 'route',
        outbound: 'direct',
      });
      expect(cfg.route.final).toBe('Auto');
    });

    it('ru-split composes with bundle=url-test (rules present, final = Auto-URLTest)', () => {
      const cfg = parse(
        buildSingboxJson([xrayEp], {
          bundle: 'url-test',
          routingPreset: 'ru-split',
        }),
      );
      expect(cfg.route.rules).toHaveLength(3);
      expect(cfg.route.final).toBe('Auto-URLTest');
    });
  });

  // ───── Routing Templates (H2) - cn-split ─────

  describe('routingPreset cn-split', () => {
    it('emits three remote binary rule-sets (ads + geosite-cn + geoip-cn)', () => {
      const cfg = parse(buildSingboxJson([xrayEp], { routingPreset: 'cn-split' }));
      const sets = cfg.route.rule_set;
      expect(sets.map((s: any) => s.tag)).toEqual([
        'geosite-category-ads-all',
        'geosite-cn',
        'geoip-cn',
      ]);
      for (const s of sets) {
        expect(s.type).toBe('remote');
        expect(s.format).toBe('binary');
        expect(s.url).toMatch(
          /^https:\/\/raw\.githubusercontent\.com\/SagerNet\/sing-(geosite|geoip)\/rule-set\/.+\.srs$/,
        );
        expect(s.download_detour).toBeUndefined();
      }
    });

    it('rules: reject ads, direct private IPs and CN, final stays Auto', () => {
      const cfg = parse(buildSingboxJson([xrayEp], { routingPreset: 'cn-split' }));
      const rules = cfg.route.rules;
      expect(rules).toHaveLength(3);
      expect(rules[0]).toEqual({
        rule_set: ['geosite-category-ads-all'],
        action: 'reject',
      });
      expect(rules[1]).toEqual({
        ip_is_private: true,
        action: 'route',
        outbound: 'direct',
      });
      expect(rules[2]).toEqual({
        rule_set: ['geosite-cn', 'geoip-cn'],
        action: 'route',
        outbound: 'direct',
      });
      expect(cfg.route.final).toBe('Auto');
    });

    it('emits NO dns block (parity with ru-split) and no RU rule-sets', () => {
      const out = buildSingboxJson([xrayEp], { routingPreset: 'cn-split' });
      const cfg = parse(out);
      expect((cfg as any).dns).toBeUndefined();
      expect(out).not.toContain('geosite-category-ru');
      expect(out).not.toContain('geoip-ru');
    });
  });

  // ───── Byte-identity regression guards (H2) ─────

  describe('routingPreset byte-identity (H2 guard)', () => {
    it('proxy-all stays byte-identical to the default build', () => {
      expect(buildSingboxJson([xrayEp], { routingPreset: 'proxy-all' })).toBe(
        buildSingboxJson([xrayEp]),
      );
    });

    it('ru-split output differs from cn-split', () => {
      expect(buildSingboxJson([xrayEp], { routingPreset: 'ru-split' })).not.toBe(
        buildSingboxJson([xrayEp], { routingPreset: 'cn-split' }),
      );
    });
  });
});
