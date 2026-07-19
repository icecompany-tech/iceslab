import { describe, expect, it } from 'vitest';
import { buildClashYaml } from './clash.js';
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

const trojanEp: SubscriptionEndpoint = {
  ...xrayEp,
  subprotocol: 'trojan',
  uri: 'trojan://...',
};

const ssEp: SubscriptionEndpoint = {
  protocol: 'shadowsocks',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 8388,
  method: '2022-blake3-aes-256-gcm',
  password: 'cabc78ae-94e3-4a16-936a-133d059acfac',
  uri: 'ss://...',
};

const mieruEp: SubscriptionEndpoint = {
  protocol: 'mieru',
  nodeName: 'eu-1',
  host: 'm1.example.com',
  port: 8443,
  username: 'alice',
  password: 'pa:ss#word',
  mtu: 1400,
  uri: 'mieru://...',
};

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

describe('buildClashYaml', () => {
  it('emits a hysteria2 proxy entry with mandatory fields', () => {
    const out = buildClashYaml([hysteriaEp]);
    expect(out).toContain('proxies:');
    expect(out).toContain('- name: eu-1-hysteria');
    expect(out).toContain('type: hysteria2');
    expect(out).toContain('server: n1.example.com');
    expect(out).toContain('port: 443');
    expect(out).toContain('password: hy-secret');
  });

  it('emits shadowtls as an ss proxy with the shadow-tls plugin', () => {
    const out = buildClashYaml([shadowtlsEp]);
    expect(out).toContain('- name: eu-1-shadowtls');
    expect(out).toContain('type: ss');
    expect(out).toContain('2022-blake3-aes-128-gcm'); // inner cipher
    expect(out).toContain('inner-ss-key'); // inner ss key (cipher password)
    expect(out).toContain('plugin: shadow-tls');
    expect(out).toContain('www.microsoft.com'); // handshake host in plugin-opts
    expect(out).toContain('stls-user-pw'); // per-user shadowtls password
    expect(out).toContain('version: 3');
  });

  it('emits a vless reality proxy entry with reality-opts block', () => {
    const out = buildClashYaml([xrayEp]);
    expect(out).toContain('- name: eu-1-xray');
    expect(out).toContain('type: vless');
    expect(out).toContain('uuid: 11111111-2222-3333-4444-555555555555');
    expect(out).toContain('flow: xtls-rprx-vision');
    expect(out).toContain('client-fingerprint: chrome');
    expect(out).toContain('reality-opts:');
    expect(out).toContain('public-key: pubkey-base64url');
    expect(out).toContain('short-id: abc123');
    // SNI must be quoted because of the dots, but bare alnum + dots is allowed
    // by our yamlString, so no quotes needed.
    expect(out).toContain('servername: www.cloudflare.com');
  });

  it('builds a url-test proxy-group listing every emitted proxy', () => {
    const out = buildClashYaml([hysteriaEp, xrayEp]);
    expect(out).toContain('- name: Auto');
    expect(out).toContain('type: url-test');
    expect(out).toMatch(/proxies:\s*\n\s+- eu-1-hysteria\s*\n\s+- eu-1-xray/);
  });

  it('produces a MATCH,DIRECT rule when no endpoints are emitted', () => {
    const out = buildClashYaml([]);
    expect(out).toContain('- MATCH,DIRECT');
    expect(out).not.toContain('- MATCH,Auto');
    // Empty proxies/groups must be valid YAML, `[]` is the safe form.
    expect(out).toMatch(/proxies:\s*\n\s+\[\]/);
    expect(out).toMatch(/proxy-groups:\s*\n\s+\[\]/);
  });

  it('quotes special chars in passwords (e.g. colon, hash)', () => {
    const out = buildClashYaml([{ ...hysteriaEp, password: 'pa:ss#word' }]);
    expect(out).toContain('password: "pa:ss#word"');
  });

  it('quotes node names containing spaces or special chars', () => {
    const out = buildClashYaml([{ ...hysteriaEp, nodeName: 'eu node #1' }]);
    expect(out).toContain('"eu node #1-hysteria"');
  });

  it('output is byte-deterministic for the same input', () => {
    const a = buildClashYaml([hysteriaEp, xrayEp]);
    const b = buildClashYaml([hysteriaEp, xrayEp]);
    expect(a).toBe(b);
  });

  it('output ends with a newline', () => {
    expect(buildClashYaml([hysteriaEp]).endsWith('\n')).toBe(true);
  });

  // ───── Slice 24c part 3a: Trojan subprotocol ─────

  it('emits a trojan proxy entry when subprotocol=trojan', () => {
    const out = buildClashYaml([trojanEp]);
    expect(out).toContain('type: trojan');
    expect(out).toContain('password: 11111111-2222-3333-4444-555555555555');
    expect(out).not.toContain('uuid:'); // Trojan uses password, not uuid
    expect(out).not.toContain('flow:'); // Vision flow VLESS-only
    // REALITY block still emitted
    expect(out).toContain('reality-opts:');
    expect(out).toContain('public-key: pubkey-base64url');
  });

  // ───── VMess + security modes (none / tls) ─────

  it('emits a vmess proxy with alterId/cipher and no reality-opts', () => {
    const out = buildClashYaml([
      { ...xrayEp, subprotocol: 'vmess', securityLayer: 'none', network: 'ws', flow: undefined },
    ]);
    expect(out).toContain('type: vmess');
    expect(out).toContain('alterId: 0');
    expect(out).toContain('cipher: auto');
    expect(out).not.toContain('reality-opts');
  });

  it('security none emits tls: false and no reality-opts', () => {
    const out = buildClashYaml([{ ...xrayEp, securityLayer: 'none' }]);
    expect(out).toContain('tls: false');
    expect(out).not.toContain('reality-opts');
  });

  it('security tls emits tls: true + servername but no reality-opts', () => {
    const out = buildClashYaml([{ ...xrayEp, securityLayer: 'tls' }]);
    expect(out).toContain('tls: true');
    expect(out).toContain('servername: www.cloudflare.com');
    expect(out).not.toContain('reality-opts');
  });

  // ───── Slice 24d: Shadowsocks ─────

  it('emits a shadowsocks (ss) proxy entry with cipher + password + udp', () => {
    const out = buildClashYaml([ssEp]);
    expect(out).toContain('- name: eu-1-shadowsocks');
    expect(out).toContain('type: ss');
    expect(out).toContain('server: n1.example.com');
    expect(out).toContain('port: 8388');
    expect(out).toContain('cipher: 2022-blake3-aes-256-gcm');
    expect(out).toContain('password: cabc78ae-94e3-4a16-936a-133d059acfac');
    expect(out).toContain('udp: true');
    // SS doesn't have TLS / REALITY blocks
    expect(out).not.toContain('tls: true');
    expect(out).not.toContain('reality-opts:');
  });

  it('mixed sub: ss alongside hysteria + vless lands in url-test group', () => {
    const out = buildClashYaml([hysteriaEp, xrayEp, ssEp]);
    expect(out).toMatch(/- eu-1-hysteria/);
    expect(out).toMatch(/- eu-1-xray/);
    expect(out).toMatch(/- eu-1-shadowsocks/);
  });

  it('emits a mieru proxy with separate username and password fields', () => {
    const out = buildClashYaml([mieruEp]);
    expect(out).toContain('- name: eu-1-mieru');
    expect(out).toContain('type: mieru');
    expect(out).toContain('server: m1.example.com');
    expect(out).toContain('port: 8443');
    expect(out).toContain('transport: TCP');
    expect(out).toContain('udp: true');
    expect(out).toContain('username: alice');
    expect(out).toContain('password: "pa:ss#word"');
    expect(out).toContain('multiplexing: MULTIPLEXING_LOW');
  });

  // ───── Slice 24c part 2: transports ─────

  it('emits ws-opts with path + Host header for ws network', () => {
    const out = buildClashYaml([
      { ...xrayEp, network: 'ws' as const, path: '/api', hostHeader: 'cdn.example.com' },
    ]);
    expect(out).toContain('network: ws');
    expect(out).toContain('ws-opts:');
    expect(out).toContain('path: /api');
    expect(out).toContain('Host: cdn.example.com');
  });

  it('emits httpupgrade-opts for httpupgrade network', () => {
    const out = buildClashYaml([
      { ...xrayEp, network: 'httpupgrade' as const, path: '/u', hostHeader: 'cdn.example.com' },
    ]);
    expect(out).toContain('network: httpupgrade');
    expect(out).toContain('httpupgrade-opts:');
    expect(out).toContain('path: /u');
    expect(out).toContain('host: cdn.example.com');
  });

  it('emits grpc-opts with grpc-service-name for grpc network', () => {
    const out = buildClashYaml([
      { ...xrayEp, network: 'grpc' as const, serviceName: 'GunSvc' },
    ]);
    expect(out).toContain('network: grpc');
    expect(out).toContain('grpc-opts:');
    expect(out).toContain('grpc-service-name: GunSvc');
  });

  it('emits network: tcp on raw (Clash terminology)', () => {
    const out = buildClashYaml([xrayEp]); // network: 'raw'
    expect(out).toContain('network: tcp');
    expect(out).not.toContain('network: raw');
  });

  // ───── Routing Templates (R1c) ─────

  describe('routingPreset', () => {
    it('default proxy-all output is byte-identical to explicit proxy-all', () => {
      expect(buildClashYaml([xrayEp], { routingPreset: 'proxy-all' })).toBe(
        buildClashYaml([xrayEp]),
      );
      const out = buildClashYaml([xrayEp]);
      expect(out).not.toContain('GEOSITE');
      expect(out).not.toContain('geox-url');
      expect(out).toContain('dns:');
      expect(out.indexOf('dns:')).toBeLessThan(out.indexOf('proxies:'));
    });

    it('ru-split emits geo block with jsdelivr mirrors and auto-update', () => {
      const out = buildClashYaml([xrayEp], { routingPreset: 'ru-split' });
      expect(out).toContain('geo-auto-update: true');
      expect(out).toContain('geo-update-interval: 72');
      expect(out).toContain(
        'geosite: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"',
      );
      expect(out).toContain(
        'mmdb: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb"',
      );
    });

    it('ru-split rules: ads reject first, RU + private direct, MATCH,Auto last', () => {
      const out = buildClashYaml([xrayEp], { routingPreset: 'ru-split' });
      const rules = out
        .slice(out.indexOf('rules:'))
        .split('\n')
        .filter((l) => l.startsWith('  - '))
        .map((l) => l.trim());
      expect(rules[0]).toBe('- GEOSITE,category-ads-all,REJECT');
      expect(rules).toContain('- GEOSITE,category-ru,DIRECT');
      expect(rules).toContain('- GEOSITE,category-gov-ru,DIRECT');
      expect(rules).toContain('- IP-CIDR,10.0.0.0/8,DIRECT,no-resolve');
      expect(rules).toContain('- IP-CIDR6,fc00::/7,DIRECT,no-resolve');
      // GEOIP,RU resolves (no no-resolve) and sits right before the catch-all.
      expect(rules[rules.length - 2]).toBe('- GEOIP,RU,DIRECT');
      expect(rules[rules.length - 1]).toBe('- MATCH,Auto');
    });

    it('ru-split with no proxies keeps MATCH,DIRECT as the catch-all', () => {
      const out = buildClashYaml([], { routingPreset: 'ru-split' });
      expect(out).toContain('- GEOSITE,category-ads-all,REJECT');
      expect(out.trimEnd().endsWith('- MATCH,DIRECT')).toBe(true);
    });

    it('proxy-all emits DNS with proxied DoH for TUN clients', () => {
      const out = buildClashYaml([xrayEp]);
      expect(out).toContain('mode: rule');
      expect(out).toContain('ipv6: false');
      expect(out).toContain('dns:');
      expect(out).toContain('  listen: 0.0.0.0:1053');
      expect(out).toContain('  enhanced-mode: redir-host');
      expect(out).toContain('    - https://1.1.1.1/dns-query#Auto');
      expect(out).toContain('    - https://8.8.8.8/dns-query#Auto');
    });

    it('proxy-all without proxies does not leave a dangling Auto DNS reference', () => {
      const out = buildClashYaml([]);
      expect(out).toContain('dns:');
      expect(out).not.toContain('#Auto');
      expect(out.trimEnd().endsWith('- MATCH,DIRECT')).toBe(true);
    });

    it('ru-split emits split-DNS block (R2)', () => {
      const out = buildClashYaml([xrayEp], { routingPreset: 'ru-split' });
      expect(out).toContain('dns:');
      expect(out).toContain('  enable: true');
      expect(out).toContain('  enhanced-mode: fake-ip');
      expect(out).toContain('  fake-ip-range: 198.18.0.1/16');
      // RU domains pinned to Yandex DNS via nameserver-policy.
      expect(out).toContain('    "geosite:category-ru": 77.88.8.8');
      expect(out).toContain('    "geosite:category-gov-ru": 77.88.8.8');
      // General resolvers are DoH; bootstrap nameservers are plain IPs.
      expect(out).toContain('    - https://1.1.1.1/dns-query');
      expect(out).toContain('  default-nameserver:');
      expect(out).toContain('  proxy-server-nameserver:');
      // DNS block sits before proxies, after the geo block.
      expect(out.indexOf('dns:')).toBeGreaterThan(out.indexOf('geox-url:'));
      expect(out.indexOf('dns:')).toBeLessThan(out.indexOf('proxies:'));
    });
  });

  // ───── Routing Templates (H2) - cn-split ─────

  describe('routingPreset cn-split', () => {
    function ruleLines(out: string): string[] {
      return out
        .slice(out.indexOf('rules:'))
        .split('\n')
        .filter((l) => l.startsWith('  - '))
        .map((l) => l.trim());
    }

    it('emits the shared geo block with jsdelivr mirrors and auto-update', () => {
      const out = buildClashYaml([xrayEp], { routingPreset: 'cn-split' });
      expect(out).toContain('geo-auto-update: true');
      expect(out).toContain('geo-update-interval: 72');
      expect(out).toContain(
        'geosite: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"',
      );
    });

    it('rules: ads reject first, one GEOSITE,cn + private direct, GEOIP,CN before catch-all', () => {
      const out = buildClashYaml([xrayEp], { routingPreset: 'cn-split' });
      const rules = ruleLines(out);
      expect(rules[0]).toBe('- GEOSITE,category-ads-all,REJECT');
      expect(rules).toContain('- GEOSITE,cn,DIRECT');
      expect(rules).toContain('- IP-CIDR,10.0.0.0/8,DIRECT,no-resolve');
      expect(rules).toContain('- IP-CIDR6,fc00::/7,DIRECT,no-resolve');
      // GEOIP,CN resolves (no no-resolve) and sits right before the catch-all.
      expect(rules[rules.length - 2]).toBe('- GEOIP,CN,DIRECT');
      expect(rules[rules.length - 1]).toBe('- MATCH,Auto');
      // No RU lines leak in.
      expect(out).not.toContain('GEOSITE,category-ru');
      expect(out).not.toContain('GEOIP,RU');
    });

    it('emits split-DNS block pinned to AliDNS via nameserver-policy', () => {
      const out = buildClashYaml([xrayEp], { routingPreset: 'cn-split' });
      expect(out).toContain('dns:');
      expect(out).toContain('  enhanced-mode: fake-ip');
      // China domains pinned to AliDNS.
      expect(out).toContain('    "geosite:cn": 223.5.5.5');
      expect(out).toContain('    - 223.5.5.5');
      // The DoH general resolvers stay identical to ru-split.
      expect(out).toContain('    - https://1.1.1.1/dns-query');
      // No Yandex resolver.
      expect(out).not.toContain('77.88.8.8');
    });
  });

  // ───── Byte-identity regression guards (H2) ─────

  describe('routingPreset byte-identity (H2 guard)', () => {
    it('proxy-all stays byte-identical to the default build', () => {
      expect(buildClashYaml([xrayEp], { routingPreset: 'proxy-all' })).toBe(
        buildClashYaml([xrayEp]),
      );
    });

    it('ru-split output differs from cn-split', () => {
      expect(buildClashYaml([xrayEp], { routingPreset: 'ru-split' })).not.toBe(
        buildClashYaml([xrayEp], { routingPreset: 'cn-split' }),
      );
    });
  });

  // R3 - operator custom domain lists.
  describe('customDomainLists (R3)', () => {
    function ruleLines(out: string): string[] {
      return out
        .slice(out.indexOf('rules:'))
        .split('\n')
        .filter((l) => l.startsWith('  - '))
        .map((l) => l.trim());
    }

    it('empty lists keep output byte-identical to no lists', () => {
      expect(
        buildClashYaml([xrayEp], { customDomainLists: { direct: [], proxy: [], block: [] } }),
      ).toBe(buildClashYaml([xrayEp]));
    });

    it('undefined lists keep output byte-identical', () => {
      expect(buildClashYaml([xrayEp], { customDomainLists: undefined })).toBe(
        buildClashYaml([xrayEp]),
      );
    });

    it('emits DOMAIN-SUFFIX rules ordered block (REJECT) -> direct (DIRECT) -> proxy (Auto)', () => {
      const out = buildClashYaml([xrayEp], {
        customDomainLists: {
          block: ['ads.example.com'],
          direct: ['example.ru'],
          proxy: ['youtube.com'],
        },
      });
      const rules = ruleLines(out);
      expect(rules[0]).toBe('- DOMAIN-SUFFIX,ads.example.com,REJECT');
      expect(rules[1]).toBe('- DOMAIN-SUFFIX,example.ru,DIRECT');
      expect(rules[2]).toBe('- DOMAIN-SUFFIX,youtube.com,Auto');
      // Catch-all stays last.
      expect(rules[rules.length - 1]).toBe('- MATCH,Auto');
    });

    it('strips xray geosite-style prefixes Clash cannot parse', () => {
      const out = buildClashYaml([xrayEp], {
        customDomainLists: {
          direct: ['domain:gosuslugi.ru', 'full:exact.ru', 'regexp:.*\\.ru'],
          proxy: [],
          block: [],
        },
      });
      const rules = ruleLines(out);
      expect(rules).toContain('- DOMAIN-SUFFIX,gosuslugi.ru,DIRECT');
      expect(rules).toContain('- DOMAIN-SUFFIX,exact.ru,DIRECT');
      expect(rules).toContain('- DOMAIN-SUFFIX,.*\\.ru,DIRECT');
      expect(out).not.toContain('domain:gosuslugi.ru');
    });

    it('drops the proxy bucket when no proxy exists (catch-all stays MATCH,DIRECT)', () => {
      const out = buildClashYaml([], {
        customDomainLists: { direct: ['example.ru'], proxy: ['youtube.com'], block: [] },
      });
      const rules = ruleLines(out);
      expect(rules).toContain('- DOMAIN-SUFFIX,example.ru,DIRECT');
      expect(out).not.toContain('youtube.com');
      expect(rules[rules.length - 1]).toBe('- MATCH,DIRECT');
    });

    it('custom-domain lines sit ahead of ru-split lines and before the catch-all', () => {
      const out = buildClashYaml([xrayEp], {
        routingPreset: 'ru-split',
        customDomainLists: { direct: ['example.ru'], proxy: [], block: [] },
      });
      const rules = ruleLines(out);
      // Custom domain line is first, ru-split block follows, MATCH,Auto last.
      expect(rules[0]).toBe('- DOMAIN-SUFFIX,example.ru,DIRECT');
      expect(rules).toContain('- GEOSITE,category-ads-all,REJECT');
      expect(rules[rules.length - 1]).toBe('- MATCH,Auto');
    });
  });
});
