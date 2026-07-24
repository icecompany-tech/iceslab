import { describe, expect, it } from 'vitest';
import { buildXrayJson, buildXrayJsonArray } from './xrayjson.js';
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

const xrayEp2: SubscriptionEndpoint = {
  ...xrayEp,
  nodeName: 'us-2',
  host: 'n2.example.com',
  uri: 'vless://...2',
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

    it('proxy-all emits no dns block; ru-split adds split DNS (R2)', () => {
      const plain = parse(buildXrayJson([xrayEp]));
      expect(plain.dns).toBeUndefined();

      const cfg = parse(buildXrayJson([xrayEp], { routingPreset: 'ru-split' }));
      expect(cfg.dns.servers).toHaveLength(2);
      // RU resolver first: object form, scoped to RU geosites, no fallback.
      expect(cfg.dns.servers[0]).toEqual({
        address: '77.88.8.8',
        domains: ['geosite:category-ru', 'geosite:category-gov-ru'],
        skipFallback: true,
      });
      // General resolver second: plain IP (no DoH bootstrap problem).
      expect(cfg.dns.servers[1]).toBe('8.8.8.8');
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

  // Routing Templates (H2) - cn-split, the China-direct mirror of ru-split.
  describe('routingPreset cn-split', () => {
    it('prepends block/direct rules (one CN domain category) ahead of the catch-all', () => {
      const cfg = parse(buildXrayJson([xrayEp], { routingPreset: 'cn-split' }));
      const rules = cfg.routing.rules;
      expect(rules).toHaveLength(4);
      expect(rules[0].domain).toEqual(['geosite:category-ads-all']);
      expect(rules[0].outboundTag).toBe('block');
      // China is one comprehensive category, so a single domain rule (not two).
      expect(rules[1].domain).toEqual(['geosite:cn']);
      expect(rules[1].outboundTag).toBe('direct');
      expect(rules[2].ip).toEqual(['geoip:private', 'geoip:cn']);
      expect(rules[2].outboundTag).toBe('direct');
      // Catch-all stays last so unmatched traffic still tunnels.
      expect(rules[3].network).toBe('tcp,udp');
      expect(rules[3].outboundTag).toBe('eu-1-xray');
    });

    it('switches domainStrategy to IPIfNonMatch', () => {
      const cfg = parse(buildXrayJson([xrayEp], { routingPreset: 'cn-split' }));
      expect(cfg.routing.domainStrategy).toBe('IPIfNonMatch');
    });

    it('adds AliDNS split DNS (223.5.5.5 scoped to geosite:cn, no fallback)', () => {
      const cfg = parse(buildXrayJson([xrayEp], { routingPreset: 'cn-split' }));
      expect(cfg.dns.servers).toHaveLength(2);
      expect(cfg.dns.servers[0]).toEqual({
        address: '223.5.5.5',
        domains: ['geosite:cn'],
        skipFallback: true,
      });
      expect(cfg.dns.servers[1]).toBe('8.8.8.8');
    });

    it('does not leak RU categories or the Yandex resolver', () => {
      const out = buildXrayJson([xrayEp], { routingPreset: 'cn-split' });
      expect(out).not.toContain('category-ru');
      expect(out).not.toContain('geoip:ru');
      expect(out).not.toContain('77.88.8.8');
    });
  });

  // Byte-identity regression guards: adding cn-split must not perturb the
  // existing presets.
  describe('routingPreset byte-identity (H2 guard)', () => {
    it('proxy-all stays byte-identical to the default build', () => {
      expect(buildXrayJson([xrayEp], { routingPreset: 'proxy-all' })).toBe(
        buildXrayJson([xrayEp]),
      );
    });

    it('ru-split output is independent of cn-split (different bytes)', () => {
      expect(buildXrayJson([xrayEp], { routingPreset: 'ru-split' })).not.toBe(
        buildXrayJson([xrayEp], { routingPreset: 'cn-split' }),
      );
    });
  });

  // TLS-fragment.
  describe('tlsFragment', () => {
    it('OFF (default / explicit false) is byte-identical to current output', () => {
      expect(buildXrayJson([xrayEp], { tlsFragment: false })).toBe(
        buildXrayJson([xrayEp]),
      );
      const cfg = parse(buildXrayJson([xrayEp]));
      // No fragment outbound, no dialerProxy on the proxy outbound.
      expect(cfg.outbounds.find((o: any) => o.tag === 'fragment')).toBeUndefined();
      const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
      expect(v.streamSettings.sockopt).toBeUndefined();
    });

    it('ON emits a freedom outbound tagged "fragment" with the fragment object', () => {
      const cfg = parse(buildXrayJson([xrayEp], { tlsFragment: true }));
      const frag = cfg.outbounds.find((o: any) => o.tag === 'fragment');
      expect(frag).toBeDefined();
      expect(frag.protocol).toBe('freedom');
      expect(frag.settings.fragment).toEqual({
        packets: 'tlshello',
        length: '100-200',
        interval: '10-20',
      });
    });

    it('ON sets sockopt.dialerProxy="fragment" on the proxy outbound (existing stream fields preserved)', () => {
      const cfg = parse(buildXrayJson([xrayEp], { tlsFragment: true }));
      const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
      expect(v.streamSettings.sockopt.dialerProxy).toBe('fragment');
      // The REALITY stream settings are untouched.
      expect(v.streamSettings.security).toBe('reality');
      expect(v.streamSettings.realitySettings.serverName).toBe('www.cloudflare.com');
      // The fragment outbound itself carries no dialerProxy (it IS the dialer).
      const frag = cfg.outbounds.find((o: any) => o.tag === 'fragment');
      expect(frag.streamSettings).toBeUndefined();
    });

    it('ON does NOT touch the direct/block outbounds', () => {
      const cfg = parse(buildXrayJson([xrayEp], { tlsFragment: true }));
      const direct = cfg.outbounds.find((o: any) => o.tag === 'direct');
      const block = cfg.outbounds.find((o: any) => o.tag === 'block');
      expect(direct.streamSettings).toBeUndefined();
      expect(block.streamSettings).toBeUndefined();
    });

    it('a node named "fragment" does not collide (its proxy tag is "fragment-xray", dialer stays "fragment")', () => {
      const named: SubscriptionEndpoint = { ...xrayEp, nodeName: 'fragment' };
      const cfg = parse(buildXrayJson([named], { tlsFragment: true }));
      const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
      expect(v.tag).toBe('fragment-xray');
      // No proxy tag equals "fragment", so the dialer keeps the canonical tag.
      expect(v.streamSettings.sockopt.dialerProxy).toBe('fragment');
      const frag = cfg.outbounds.find((o: any) => o.tag === 'fragment');
      expect(frag).toBeDefined();
      expect(frag.protocol).toBe('freedom');
      // Every outbound tag stays unique.
      const tags = cfg.outbounds.map((o: any) => o.tag);
      expect(new Set(tags).size).toBe(tags.length);
    });

    it('no xray endpoints: nothing fragment-related is emitted', () => {
      const cfg = parse(buildXrayJson([hysteriaEp], { tlsFragment: true }));
      expect(cfg.outbounds.find((o: any) => o.tag === 'fragment')).toBeUndefined();
    });

    it('composes with the ru-split routing preset (fragment outbound + split rules, unique tags)', () => {
      const cfg = parse(
        buildXrayJson([xrayEp], { tlsFragment: true, routingPreset: 'ru-split' }),
      );
      // Fragment outbound present + proxy dials through it.
      const frag = cfg.outbounds.find((o: any) => o.tag === 'fragment');
      expect(frag).toBeDefined();
      const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
      expect(v.streamSettings.sockopt.dialerProxy).toBe('fragment');
      // ru-split rules + split DNS still present.
      expect(cfg.routing.domainStrategy).toBe('IPIfNonMatch');
      expect(cfg.routing.rules[0].outboundTag).toBe('block');
      expect(cfg.dns.servers).toHaveLength(2);
      // Every outbound tag is unique.
      const tags = cfg.outbounds.map((o: any) => o.tag);
      expect(new Set(tags).size).toBe(tags.length);
    });
  });

  // XKeen / router target (?format=xkeen).
  describe('forRouter (xkeen)', () => {
    it('omits log and the client inbound, keeps outbounds + routing', () => {
      const cfg = parse(buildXrayJson([xrayEp], { forRouter: true }));
      expect(cfg.log).toBeUndefined();
      expect(cfg.inbounds).toBeUndefined();
      // proxy + freedom + blackhole still present for routing rules to reference.
      expect(cfg.outbounds.find((o: any) => o.protocol === 'vless')).toBeDefined();
      expect(cfg.outbounds.find((o: any) => o.protocol === 'freedom')).toBeDefined();
      expect(cfg.outbounds.find((o: any) => o.protocol === 'blackhole')).toBeDefined();
      expect(cfg.routing.rules[0].outboundTag).toBe('eu-1-xray');
    });

    it('still emits split-DNS + ru-split rules when the preset is ru-split', () => {
      const cfg = parse(buildXrayJson([xrayEp], { forRouter: true, routingPreset: 'ru-split' }));
      expect(cfg.inbounds).toBeUndefined();
      expect(cfg.dns.servers).toHaveLength(2);
      expect(cfg.routing.rules[0].outboundTag).toBe('block');
    });

    it('desktop (client) form is unchanged: keeps log + inbound', () => {
      const cfg = parse(buildXrayJson([xrayEp]));
      expect(cfg.log).toBeDefined();
      expect(cfg.inbounds).toHaveLength(1);
    });
  });

  // R3-b - raw custom routing rules.
  describe('customRules (R3-b)', () => {
    it('prepends custom rules ahead of preset rules and the catch-all', () => {
      const custom = [{ type: 'field', domain: ['my.corp'], outboundTag: 'direct' }];
      const cfg = parse(buildXrayJson([xrayEp], { customRules: custom, routingPreset: 'ru-split' }));
      const rules = cfg.routing.rules;
      expect(rules[0]).toEqual(custom[0]); // custom rule wins (first)
      expect(rules[rules.length - 1].outboundTag).toBe('eu-1-xray'); // catch-all stays last
      // the ru-split block still sits between custom and catch-all
      expect(JSON.stringify(rules)).toContain('geosite:category-ru');
    });

    it('empty / absent custom rules keep output byte-identical', () => {
      expect(buildXrayJson([xrayEp], { customRules: [] })).toBe(buildXrayJson([xrayEp]));
    });
  });

  // R3 - operator custom domain lists.
  describe('customDomainLists (R3)', () => {
    it('empty lists keep output byte-identical to no lists', () => {
      expect(
        buildXrayJson([xrayEp], { customDomainLists: { direct: [], proxy: [], block: [] } }),
      ).toBe(buildXrayJson([xrayEp]));
    });

    it('undefined lists keep output byte-identical', () => {
      expect(buildXrayJson([xrayEp], { customDomainLists: undefined })).toBe(
        buildXrayJson([xrayEp]),
      );
    });

    it('emits one field rule per non-empty bucket, ordered block -> direct -> proxy', () => {
      const cfg = parse(
        buildXrayJson([xrayEp], {
          customDomainLists: {
            block: ['ads.example.com'],
            direct: ['example.ru', 'domain:gosuslugi.ru'],
            proxy: ['youtube.com'],
          },
        }),
      );
      const rules = cfg.routing.rules;
      // block first, then direct, then proxy, then the catch-all.
      expect(rules[0]).toEqual({ type: 'field', domain: ['ads.example.com'], outboundTag: 'block' });
      expect(rules[1]).toEqual({
        type: 'field',
        domain: ['example.ru', 'domain:gosuslugi.ru'],
        outboundTag: 'direct',
      });
      expect(rules[2]).toEqual({ type: 'field', domain: ['youtube.com'], outboundTag: 'eu-1-xray' });
      // Catch-all stays last.
      expect(rules[rules.length - 1].outboundTag).toBe('eu-1-xray');
      expect(rules[rules.length - 1].network).toBe('tcp,udp');
    });

    it('only emits buckets that have entries (proxy-only)', () => {
      const cfg = parse(
        buildXrayJson([xrayEp], {
          customDomainLists: { direct: [], proxy: ['youtube.com'], block: [] },
        }),
      );
      const rules = cfg.routing.rules;
      // proxy rule then catch-all (no block/direct rules).
      expect(rules).toHaveLength(2);
      expect(rules[0]).toEqual({ type: 'field', domain: ['youtube.com'], outboundTag: 'eu-1-xray' });
    });

    it('drops the proxy bucket when no xray endpoint exists (no valid proxy tag)', () => {
      const cfg = parse(
        buildXrayJson([hysteriaEp], {
          customDomainLists: { direct: ['example.ru'], proxy: ['youtube.com'], block: [] },
        }),
      );
      const rules = cfg.routing.rules;
      // direct rule survives; proxy rule is dropped (no proxy tag to target).
      expect(rules[0]).toEqual({ type: 'field', domain: ['example.ru'], outboundTag: 'direct' });
      expect(JSON.stringify(rules)).not.toContain('youtube.com');
    });

    it('slots between raw custom rules and the preset rules (raw > lists > preset)', () => {
      const custom = [{ type: 'field', domain: ['my.corp'], outboundTag: 'direct' }];
      const cfg = parse(
        buildXrayJson([xrayEp], {
          customRules: custom,
          customDomainLists: { direct: ['example.ru'], proxy: [], block: [] },
          routingPreset: 'ru-split',
        }),
      );
      const rules = cfg.routing.rules;
      // Order: raw custom rule, then domain-list rule, then ru-split block, then catch-all.
      expect(rules[0]).toEqual(custom[0]);
      expect(rules[1]).toEqual({ type: 'field', domain: ['example.ru'], outboundTag: 'direct' });
      expect(rules[2].domain).toEqual(['geosite:category-ads-all']);
      expect(rules[rules.length - 1].outboundTag).toBe('eu-1-xray');
    });

    it('does not change domainStrategy for proxy-all (domain rules work under AsIs)', () => {
      const cfg = parse(
        buildXrayJson([xrayEp], {
          customDomainLists: { direct: ['example.ru'], proxy: [], block: [] },
        }),
      );
      expect(cfg.routing.domainStrategy).toBe('AsIs');
    });
  });
});

// T1 - A1 array format. The migration blocker: Happ reads the single-config
// buildXrayJson as ONE server; this array is N standalone configs it reads as N
// servers. buildXrayJson must stay untouched (still needed for the balancer).
describe('buildXrayJsonArray (T1)', () => {
  it('produces a top-level JSON array with a trailing newline', () => {
    const out = buildXrayJsonArray([xrayEp, xrayEp2]);
    expect(out.endsWith('\n')).toBe(true);
    const arr = parse(out);
    expect(Array.isArray(arr)).toBe(true);
  });

  it('emits one standalone config per xray endpoint', () => {
    const arr = parse(buildXrayJsonArray([xrayEp, xrayEp2]));
    expect(arr).toHaveLength(2);
    expect(arr[0].remarks).toBe('eu-1');
    expect(arr[1].remarks).toBe('us-2');
  });

  it('each element is a full config: own socks inbound + proxy/direct/block outbounds', () => {
    const arr = parse(buildXrayJsonArray([xrayEp]));
    const cfg = arr[0];
    expect(cfg.inbounds).toHaveLength(1);
    expect(cfg.inbounds[0].protocol).toBe('socks');
    expect(cfg.inbounds[0].port).toBe(10808);
    const tags = cfg.outbounds.map((o: any) => o.tag);
    expect(tags).toEqual(['eu-1-xray', 'direct', 'block']);
  });

  it('per-config routing: bittorrent -> direct, catch-all -> that proxy', () => {
    const arr = parse(buildXrayJsonArray([xrayEp, xrayEp2]));
    // config[1] routes to ITS OWN proxy, not the first one.
    const rules = arr[1].routing.rules;
    expect(rules[0]).toEqual({ type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' });
    expect(rules[1]).toEqual({ type: 'field', network: 'tcp,udp', outboundTag: 'us-2-xray' });
  });

  it('reuses buildProxyOutbound: the proxy carries REALITY + the endpoint uuid', () => {
    const arr = parse(buildXrayJsonArray([xrayEp]));
    const v = arr[0].outbounds.find((o: any) => o.protocol === 'vless');
    expect(v.streamSettings.security).toBe('reality');
    expect(v.streamSettings.realitySettings.serverName).toBe('www.cloudflare.com');
    expect(v.settings.vnext[0].users[0].id).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('ignores non-xray endpoints (xray-only format)', () => {
    expect(parse(buildXrayJsonArray([hysteriaEp]))).toEqual([]);
    expect(parse(buildXrayJsonArray([hysteriaEp, xrayEp]))).toHaveLength(1);
  });
});

// T2 - the array carries the same routing surface as the single-config builder,
// but every proxy target is THIS config's own proxy.
describe('buildXrayJsonArray routing (T2)', () => {
  it('applies the ru-split preset per config: split rules, split DNS, IPIfNonMatch', () => {
    const arr = parse(buildXrayJsonArray([xrayEp, xrayEp2], { routingPreset: 'ru-split' }));
    for (const [i, cfg] of arr.entries()) {
      const ownTag = i === 0 ? 'eu-1-xray' : 'us-2-xray';
      expect(cfg.routing.domainStrategy).toBe('IPIfNonMatch');
      expect(cfg.dns.servers[0].address).toBe('77.88.8.8');
      const rules = cfg.routing.rules;
      // block/direct split rules present, then bittorrent, then catch-all to OWN proxy.
      expect(rules[0].domain).toEqual(['geosite:category-ads-all']);
      expect(rules[rules.length - 1]).toEqual({
        type: 'field',
        network: 'tcp,udp',
        outboundTag: ownTag,
      });
    }
  });

  it('proxy-all: no split DNS, AsIs, just bittorrent + catch-all', () => {
    const cfg = parse(buildXrayJsonArray([xrayEp]))[0];
    expect(cfg.dns).toBeUndefined();
    expect(cfg.routing.domainStrategy).toBe('AsIs');
    expect(cfg.routing.rules).toHaveLength(2);
  });

  it('custom domain lists target THIS config proxy, not a shared first', () => {
    const arr = parse(
      buildXrayJsonArray([xrayEp, xrayEp2], {
        customDomainLists: { block: [], direct: [], proxy: ['youtube.com'] },
      }),
    );
    // config[1]'s proxy rule points at us-2-xray, not eu-1-xray.
    const proxyRule = arr[1].routing.rules.find((r: any) => r.domain?.includes('youtube.com'));
    expect(proxyRule.outboundTag).toBe('us-2-xray');
  });

  it('prepends raw customRules ahead of everything per config', () => {
    const custom = [{ type: 'field', domain: ['my.corp'], outboundTag: 'direct' }];
    const cfg = parse(buildXrayJsonArray([xrayEp], { customRules: custom }))[0];
    expect(cfg.routing.rules[0]).toEqual(custom[0]);
  });

  it('tlsFragment: each config gets its own fragment outbound + proxy dials through it', () => {
    const arr = parse(buildXrayJsonArray([xrayEp, xrayEp2], { tlsFragment: true }));
    for (const cfg of arr) {
      const frag = cfg.outbounds.find((o: any) => o.tag === 'fragment');
      expect(frag).toBeDefined();
      expect(frag.settings.fragment).toEqual({
        packets: 'tlshello',
        length: '100-200',
        interval: '10-20',
      });
      const v = cfg.outbounds.find((o: any) => o.protocol === 'vless');
      expect(v.streamSettings.sockopt.dialerProxy).toBe('fragment');
    }
  });

  it('carries the endpoint transport into the array proxy (xhttp)', () => {
    const xhttpEp: SubscriptionEndpoint = {
      ...xrayEp,
      network: 'xhttp',
      path: '/dl',
      hostHeader: 'cdn.example.com',
    };
    const v = parse(buildXrayJsonArray([xhttpEp]))[0].outbounds.find(
      (o: any) => o.protocol === 'vless',
    );
    expect(v.streamSettings.network).toBe('xhttp');
    expect(v.streamSettings.xhttpSettings.path).toBe('/dl');
    expect(v.streamSettings.xhttpSettings.mode).toBe('auto');
  });
});
