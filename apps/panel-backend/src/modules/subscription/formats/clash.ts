import type { RoutingPresetId } from '@iceslab/shared';
import type { SubscriptionEndpoint } from '../subscription.formats.js';
import { buildRoscomVpnSections } from './clash.roscomvpn.js';

/**
 * Clash YAML subscription formatter (targets Clash Meta / Mihomo, covers
 * VLESS+REALITY, Hysteria2, Trojan+REALITY, and Shadowsocks native types).
 *
 * Scope:
 *   - hysteria              → `type: hysteria2`
 *   - xray (VLESS+REALITY)  → `type: vless` with `reality-opts`
 *   - xray (Trojan+REALITY) → `type: trojan` with `reality-opts` (slice 24c part 3a)
 *   - shadowsocks           → `type: ss` with cipher + password (slice 24d)
 *   - mieru                 → `type: mieru` with username + password
 *   - amneziawg / naive are NOT emitted: classic Clash has no native support
 *     and Clash Meta's experimental wireguard/naive support diverges per
 *     fork. AmneziaWG users get the wg-quick `.conf` format; Naive users
 *     get the naive+https URI directly.
 *
 * The output is hand-emitted YAML (no js-yaml dep): the schema is fixed and
 * small, and string-based generation gives us bit-for-bit deterministic
 * output across runs (good for diff-testing and avoiding spurious config
 * reloads in clients that hash the body).
 */

// Quote a value with double quotes if it contains anything that would need
// escaping in YAML, otherwise emit it bare. Conservative: passwords, names,
// and reality short-ids may contain `:`, `#`, special chars.
function yamlString(value: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(value)) return value;
  return JSON.stringify(value); // double-quoted, JSON escapes are valid YAML
}

/**
 * Routing Templates (R1c + H2) - a split `routingPreset` prepends split-routing
 * rules ahead of the MATCH catch-all (ads -> REJECT, region domains / region
 * IPs / private ranges -> DIRECT) and emits a geo-database block so mihomo can
 * fetch geosite.dat / country.mmdb itself. `ru-split` uses RU categories +
 * Yandex DNS; `cn-split` uses GEOSITE,cn / GEOIP,CN + AliDNS 223.5.5.5:
 *
 *   - `geox-url` points at the testingcf.jsdelivr.net mirror of
 *     MetaCubeX/meta-rules-dat (the docs' own example) because the default
 *     raw.githubusercontent.com source is blocked in RU - exactly where this
 *     preset is used. `geo-auto-update` keeps the databases fresh.
 *   - Private ranges are explicit IP-CIDR/IP-CIDR6 rules with `no-resolve`
 *     (deterministic, no geo dependency) instead of a mmdb pseudo-country.
 *   - `GEOIP,RU` stays last among the DIRECT rules and without `no-resolve`:
 *     it is the fallback that may resolve a domain that missed every GEOSITE
 *     rule before deciding tunnel-vs-direct.
 *
 * Default 'proxy-all' keeps the output byte-identical to pre-R1 builds.
 */
export interface ClashBuildOpts {
  routingPreset?: RoutingPresetId;
  /**
   * R3 - operator-defined custom domain lists (direct/proxy/block). Each domain
   * becomes a `DOMAIN-SUFFIX` rule emitted at the head of the `rules:` section
   * (before any ru-split lines and the MATCH catch-all). xray geosite-style
   * prefixes (domain:/full:/regexp:/keyword:) are stripped since Clash does not
   * understand them. Empty/undefined = none = byte-identical output.
   */
  customDomainLists?: { direct: string[]; proxy: string[]; block: string[] };
}

// Geo-database block (shared by every split preset). The testingcf.jsdelivr.net
// mirror of MetaCubeX/meta-rules-dat carries both `cn` and `ru` geo data, so
// this block is preset-independent. NOTE (H2): jsdelivr CDN reachability inside
// mainland China is variable (a different problem than RU's GitHub block), so
// the CN geo-db fetch source may need field validation; if so it is a one-line
// URL swap here, not a redesign.
const SPLIT_GEO_LINES: readonly string[] = [
  'geo-auto-update: true',
  'geo-update-interval: 72',
  'geox-url:',
  '  geosite: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"',
  '  geoip: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat"',
  '  mmdb: "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb"',
  '',
];

/**
 * Split DNS (R2). fake-ip keeps app-side resolution instant; RU domains are
 * answered by Yandex DNS (77.88.8.8) via nameserver-policy so RU CDNs return
 * geo-correct IPs, everything else goes to DoH. `default-nameserver` and
 * `proxy-server-nameserver` are plain IPs: they bootstrap the DoH hostnames
 * and resolve the proxy node addresses without a chicken-and-egg loop.
 * NOTE: mihomo sends DNS directly (not through the tunnel) by default; DoH
 * keeps those queries encrypted on the wire.
 */
const RU_SPLIT_DNS_LINES: readonly string[] = [
  'dns:',
  '  enable: true',
  '  enhanced-mode: fake-ip',
  '  fake-ip-range: 198.18.0.1/16',
  '  fake-ip-filter:',
  '    - "*.lan"',
  '    - "+.local"',
  '  default-nameserver:',
  '    - 77.88.8.8',
  '    - 1.1.1.1',
  '  proxy-server-nameserver:',
  '    - 77.88.8.8',
  '    - 1.1.1.1',
  '  nameserver:',
  '    - https://1.1.1.1/dns-query',
  '    - https://dns.google/dns-query',
  '  nameserver-policy:',
  '    "geosite:category-ru": 77.88.8.8',
  '    "geosite:category-gov-ru": 77.88.8.8',
  '',
];

/**
 * Split DNS (H2) - the China mirror of RU_SPLIT_DNS_LINES. China domains are
 * answered by AliDNS (223.5.5.5) via nameserver-policy so CN CDNs return
 * geo-correct IPs; the bootstrap / proxy-server nameservers swap Yandex for
 * AliDNS. The DoH `nameserver` block and the fake-ip block stay identical.
 */
const CN_SPLIT_DNS_LINES: readonly string[] = [
  'dns:',
  '  enable: true',
  '  enhanced-mode: fake-ip',
  '  fake-ip-range: 198.18.0.1/16',
  '  fake-ip-filter:',
  '    - "*.lan"',
  '    - "+.local"',
  '  default-nameserver:',
  '    - 223.5.5.5',
  '    - 1.1.1.1',
  '  proxy-server-nameserver:',
  '    - 223.5.5.5',
  '    - 1.1.1.1',
  '  nameserver:',
  '    - https://1.1.1.1/dns-query',
  '    - https://dns.google/dns-query',
  '  nameserver-policy:',
  '    "geosite:cn": 223.5.5.5',
  '',
];

const PROXY_ALL_DOH_NAMESERVERS = [
  'https://1.1.1.1/dns-query',
  'https://8.8.8.8/dns-query',
] as const;

function buildProxyAllDnsLines(hasProxyGroup: boolean): string[] {
  const viaProxy = (nameserver: string): string =>
    hasProxyGroup ? `${nameserver}#Auto` : nameserver;

  return [
    'mode: rule',
    'ipv6: false',
    'dns:',
    '  enable: true',
    '  listen: 0.0.0.0:1053',
    '  ipv6: false',
    '  enhanced-mode: redir-host',
    '  default-nameserver:',
    '    - 1.1.1.1',
    '    - 8.8.8.8',
    '  proxy-server-nameserver:',
    '    - 1.1.1.1',
    '    - 8.8.8.8',
    '  nameserver:',
    ...PROXY_ALL_DOH_NAMESERVERS.map((nameserver) => `    - ${viaProxy(nameserver)}`),
    '',
  ];
}

const RU_SPLIT_RULE_LINES: readonly string[] = [
  '  - GEOSITE,category-ads-all,REJECT',
  '  - GEOSITE,category-ru,DIRECT',
  '  - GEOSITE,category-gov-ru,DIRECT',
  '  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  '  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  '  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  '  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  '  - IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
  '  - IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  '  - IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  '  - IP-CIDR6,::1/128,DIRECT,no-resolve',
  '  - GEOIP,RU,DIRECT',
];

// H2 - the China mirror of RU_SPLIT_RULE_LINES. The private-CIDR block is
// verbatim; only the geo lines change (one GEOSITE,cn instead of the two RU
// categories, and GEOIP,CN instead of GEOIP,RU). GEOIP,CN stays last and
// without `no-resolve`: it is the resolve-then-decide fallback for a domain
// that missed every GEOSITE rule.
const CN_SPLIT_RULE_LINES: readonly string[] = [
  '  - GEOSITE,category-ads-all,REJECT',
  '  - GEOSITE,cn,DIRECT',
  '  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  '  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  '  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  '  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  '  - IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
  '  - IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  '  - IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  '  - IP-CIDR6,::1/128,DIRECT,no-resolve',
  '  - GEOIP,CN,DIRECT',
];

export function buildClashYaml(
  endpoints: SubscriptionEndpoint[],
  buildOpts: ClashBuildOpts = {},
): string {
  // Routing preset (R1c + H2). Each split preset selects its own DNS + rule
  // lines (the geo-db block is shared); proxy-all leaves them null so the
  // output stays byte-identical to pre-R1 builds.
  const preset = buildOpts.routingPreset ?? 'proxy-all';
  const splitDnsLines =
    preset === 'ru-split'
      ? RU_SPLIT_DNS_LINES
      : preset === 'cn-split'
        ? CN_SPLIT_DNS_LINES
        : null;
  const splitRuleLines =
    preset === 'ru-split'
      ? RU_SPLIT_RULE_LINES
      : preset === 'cn-split'
        ? CN_SPLIT_RULE_LINES
        : null;
  const useRoscomVpn = preset === 'roscomvpn';
  const proxies: string[] = [];
  const proxyNames: string[] = [];

  for (const e of endpoints) {
    const name = `${e.nodeName}-${e.protocol}`;
    if (e.protocol === 'hysteria') {
      proxyNames.push(name);
      const lines = [
        `  - name: ${yamlString(name)}`,
        `    type: hysteria2`,
        `    server: ${e.host}`,
        `    port: ${e.port}`,
        `    password: ${yamlString(e.password)}`,
      ];
      if (e.obfsPassword) {
        lines.push(
          `    obfs: salamander`,
          `    obfs-password: ${yamlString(e.obfsPassword)}`,
        );
      }
      // Slice 31.5: Clash Meta (mihomo) port-hopping. The `ports` key
      // accepts a `START-END` (hyphen) or comma-list form; we emit the
      // hyphen form to match the URI's `mport`. Server-side iptables
      // REDIRECT range must cover this.
      if (
        typeof e.portHoppingStart === 'number' &&
        typeof e.portHoppingEnd === 'number'
      ) {
        lines.push(`    ports: ${e.portHoppingStart}-${e.portHoppingEnd}`);
      }
      proxies.push(lines.join('\n'));
    } else if (e.protocol === 'xray') {
      proxyNames.push(name);
      const sub = e.subprotocol ?? 'vless';
      // Clash Meta `network` uses "tcp" for our "raw".
      const network = e.network === 'raw' || !e.network ? 'tcp' : e.network;
      // securityLayer: 'default' = REALITY, else 'tls' (own cert) / 'none'
      // (plain, e.g. CDN terminates TLS). REALITY emits reality-opts; tls emits
      // a plain TLS block; none disables client TLS.
      const sec = e.securityLayer ?? 'default';
      const isReality = sec === 'default';
      const useTls = sec !== 'none';

      const block = [
        `  - name: ${yamlString(name)}`,
        `    type: ${sub === 'trojan' ? 'trojan' : sub === 'vmess' ? 'vmess' : 'vless'}`,
        `    server: ${e.host}`,
        `    port: ${e.port}`,
        sub === 'trojan' ? `    password: ${yamlString(e.uuid)}` : `    uuid: ${e.uuid}`,
      ];
      // VMess needs alterId (0 = AEAD) + a client cipher.
      if (sub === 'vmess') {
        block.push(`    alterId: 0`, `    cipher: auto`);
      }
      block.push(`    network: ${network}`, `    tls: ${useTls}`, `    udp: true`);
      if (useTls && e.sni) {
        block.push(`    servername: ${yamlString(e.sni)}`);
      }
      // Vision flow needs a TLS-like layer (reality or tls), not plain none.
      if (sub === 'vless' && useTls && e.flow) {
        block.push(`    flow: ${yamlString(e.flow)}`);
      }
      if (e.alpn && e.alpn.length > 0) {
        block.push(`    alpn: [${e.alpn.map((a) => yamlString(a)).join(', ')}]`);
      }
      if (e.allowInsecure) {
        block.push(`    skip-cert-verify: true`);
      }
      if (useTls && e.fingerprint) {
        block.push(`    client-fingerprint: ${yamlString(e.fingerprint)}`);
      }
      // REALITY material only for the reality layer.
      if (isReality) {
        block.push(
          `    reality-opts:`,
          `      public-key: ${yamlString(e.publicKey)}`,
          `      short-id: ${yamlString(e.shortId)}`,
        );
      }
      // Transport-specific options for ws/httpupgrade. Clash Meta accepts
      // the underscore-less `httpupgrade` form on modern Mihomo (≥1.18);
      // older builds wanted `http-upgrade`, but we don't target those.
      // grpc has its own block below.
      if (network === 'ws' || network === 'httpupgrade') {
        const optsKey = `${network}-opts`;
        const opts: string[] = [];
        if (e.path) opts.push(`      path: ${yamlString(e.path)}`);
        if (e.hostHeader) {
          if (network === 'ws') {
            opts.push(`      headers:`);
            opts.push(`        Host: ${yamlString(e.hostHeader)}`);
          } else {
            opts.push(`      host: ${yamlString(e.hostHeader)}`);
          }
        }
        if (opts.length > 0) {
          block.push(`    ${optsKey}:`);
          block.push(...opts);
        }
      }
      if (network === 'grpc' && e.serviceName) {
        block.push(`    grpc-opts:`);
        block.push(`      grpc-service-name: ${yamlString(e.serviceName)}`);
      }

      proxies.push(block.join('\n'));
    } else if (e.protocol === 'shadowsocks') {
      // Slice 24d: Clash Meta uses `type: ss` with a `cipher` field that
      // matches our `method` exactly (clash and xray share the SS2022 names).
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: ss`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    cipher: ${yamlString(e.method)}`,
          `    password: ${yamlString(e.password)}`,
          `    udp: true`,
        ].join('\n'),
      );
    } else if (e.protocol === 'mieru') {
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: mieru`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    transport: TCP`,
          `    udp: true`,
          `    username: ${yamlString(e.username)}`,
          `    password: ${yamlString(e.password)}`,
          `    multiplexing: MULTIPLEXING_LOW`,
        ].join('\n'),
      );
    } else if (e.protocol === 'tuic') {
      // TUIC v5 (sing-box engine) -> mihomo `type: tuic`. Self-signed cert in
      // the alpha so skip-cert-verify; uuid+password auth, native UDP relay.
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: tuic`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    uuid: ${yamlString(e.uuid)}`,
          `    password: ${yamlString(e.password)}`,
          `    congestion-controller: ${yamlString(e.congestionControl || 'bbr')}`,
          `    alpn: [h3]`,
          `    sni: ${yamlString(e.serverName)}`,
          `    udp-relay-mode: native`,
          `    skip-cert-verify: true`,
        ].join('\n'),
      );
    } else if (e.protocol === 'anytls') {
      // AnyTLS (sing-box engine) -> mihomo `type: anytls`. Password-only auth;
      // self-signed cert in the alpha so skip-cert-verify.
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: anytls`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    password: ${yamlString(e.password)}`,
          `    sni: ${yamlString(e.serverName)}`,
          `    skip-cert-verify: true`,
        ].join('\n'),
      );
    } else if (e.protocol === 'shadowtls') {
      // ShadowTLS v3 -> mihomo `type: ss` with the `shadow-tls` plugin. The ss
      // cipher/password is the inner key; plugin-opts carries the shadowtls host
      // (camouflage SNI) + per-user password + version. shadow-tls does a real
      // handshake to a valid host, so no skip-cert-verify.
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: ss`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    cipher: ${yamlString(e.ssMethod)}`,
          `    password: ${yamlString(e.ssPassword)}`,
          `    plugin: shadow-tls`,
          `    plugin-opts:`,
          `      host: ${yamlString(e.handshake)}`,
          `      password: ${yamlString(e.shadowtlsPassword)}`,
          `      version: 3`,
          `    udp: true`,
        ].join('\n'),
      );
    }
  }

  const roscomVpn =
    useRoscomVpn && proxyNames.length > 0 ? buildRoscomVpnSections() : null;
  const lines: string[] = [];
  if (splitRuleLines) {
    lines.push(...SPLIT_GEO_LINES);
    lines.push(...splitDnsLines!);
  } else if (roscomVpn) {
    lines.push(...roscomVpn.headerLines);
  } else {
    lines.push(...buildProxyAllDnsLines(proxyNames.length > 0));
  }
  lines.push('proxies:');
  if (proxies.length === 0) {
    lines.push('  []');
  } else {
    lines.push(...proxies);
  }
  lines.push('');

  if (roscomVpn) {
    lines.push(...roscomVpn.providerLines, '');
  }

  lines.push('proxy-groups:');
  if (proxyNames.length > 0) {
    lines.push('  - name: Auto');
    lines.push('    type: url-test');
    lines.push('    url: http://www.gstatic.com/generate_204');
    lines.push('    interval: 300');
    lines.push('    proxies:');
    for (const n of proxyNames) {
      lines.push(`      - ${yamlString(n)}`);
    }
  } else {
    lines.push('  []');
  }
  lines.push('');

  // R3 - operator custom domain lists -> DOMAIN-SUFFIX rules. Order
  // block -> direct -> proxy so a block listing wins over a direct/proxy
  // listing of an overlapping domain. Strip xray geosite-style prefixes Clash
  // cannot parse. The proxy bucket targets the existing `Auto` proxy-group, so
  // it is only emitted when at least one proxy exists.
  const cdl = buildOpts.customDomainLists;
  const stripPfx = (d: string): string => d.replace(/^(domain|full|regexp|keyword):/, '');
  const customDomainLines: string[] = cdl
    ? [
        ...cdl.block.map((d) => `  - DOMAIN-SUFFIX,${stripPfx(d)},REJECT`),
        ...cdl.direct.map((d) => `  - DOMAIN-SUFFIX,${stripPfx(d)},DIRECT`),
        ...(proxyNames.length > 0
          ? cdl.proxy.map((d) => `  - DOMAIN-SUFFIX,${stripPfx(d)},Auto`)
          : []),
      ]
    : [];

  lines.push('rules:');
  // Custom-domain lines first (highest precedence), then the split-preset
  // lines, then the MATCH catch-all. When the lists are empty this spread is a
  // no-op.
  lines.push(...customDomainLines);
  if (splitRuleLines) {
    lines.push(...splitRuleLines);
  } else if (roscomVpn) {
    lines.push(...roscomVpn.ruleLines);
  }
  lines.push(proxyNames.length > 0 ? '  - MATCH,Auto' : '  - MATCH,DIRECT');

  return lines.join('\n') + '\n';
}
