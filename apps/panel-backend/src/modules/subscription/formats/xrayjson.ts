import type { RoutingPresetId } from '@iceslab/shared';
import type { SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Xray-core client JSON subscription formatter.
 *
 * Targets v2rayN, NekoRay/NekoBox in Xray mode, and any client that imports
 * "Xray JSON" subscription URLs (i.e. apps that run xray-core under the hood).
 *
 * Scope: VLESS+REALITY+Vision endpoints only. Hysteria2 is reachable from
 * Xray (via the `hysteria2` outbound) but most Xray-native clients still
 * default to vmess/vless, users who want Hysteria pick the Sing-box format
 * or the plain hysteria2:// URI directly. Keeping this format VLESS-only
 * dodges the cross-protocol matrix and avoids subtle xray-version-coupled
 * outbound shape drift.
 *
 * Output shape:
 *   - `log`: warning-level
 *   - `inbounds`: a single SOCKS5 inbound on 127.0.0.1:10808 (UDP enabled)
 *     so local apps can dial through the tunnel
 *   - `outbounds`: one vless+REALITY entry per endpoint, plus `freedom`
 *     (`direct`) and `blackhole` (`block`) for routing rules
 *   - `routing`: catch-all → first proxy. The client UI lets the user pick
 *     a different outbound by tag.
 */
/**
 * Slice 29 follow-up: Xray `observatory + balancer` for auto-failover.
 * When `bundle === 'balancer'`, we emit an `observatory` block that periodically
 * probes every proxy outbound, and route through a balancer-tagged tag that
 * picks the lowest-latency one. Default ('flat') keeps the legacy "first
 * outbound wins" routing rule for back-compat.
 */
/**
 * TLS-fragment - when `tlsFragment` is on we emit a `freedom` outbound carrying
 * a `fragment` object and dial every proxy outbound THROUGH it via
 * `streamSettings.sockopt.dialerProxy`. This splits the client's outgoing
 * ClientHello so SNI-based DPI (RU TSPU / RKN) cannot cleanly match the
 * handshake. Defaults mirror the upstream-verified shape:
 * packets="tlshello" (fragments the TLS handshake), length="100-200",
 * interval="10-20". The fragment outbound's tag MUST exactly equal the
 * dialerProxy value; we pick a tag that cannot collide with any proxy/direct/
 * block tag. When off, the output stays byte-identical to pre-fragment builds.
 */
/**
 * Routing Templates (R1a + H2) - a split `routingPreset` prepends split-routing
 * rules ahead of the catch-all: ads/malware -> block, region domains + region/
 * private IPs -> direct, everything else falls through to the tunnel.
 *   - `ru-split`: RU domains (geosite:category-ru + category-gov-ru) + geoip:ru.
 *   - `cn-split`: China domains (geosite:cn) + geoip:cn (single comprehensive
 *     category, so one domain rule not two), clean DNS via AliDNS 223.5.5.5.
 * Uses the geosite:/geoip: databases that ship inside every xray client
 * install, so no extra files are needed. `domainStrategy` switches to
 * IPIfNonMatch so domains that miss every domain rule get a second, IP-based
 * pass (otherwise geoip:ru / geoip:cn never matches a domain-typed
 * destination). Default 'proxy-all' keeps the output byte-identical to pre-R1
 * builds.
 */
export interface XrayJsonBuildOpts {
  bundle?: 'flat' | 'balancer';
  probeUrl?: string;
  probeIntervalSec?: number;
  routingPreset?: RoutingPresetId;
  /**
   * XKeen / router target (`?format=xkeen`). XKeen runs xray-core on a Keenetic
   * router via a confdir split (01_log / 02_dns / 03_inbounds / 04_outbounds /
   * 05_routing ...). The router supplies its own log + transparent inbound, so
   * we omit `log` and `inbounds` and emit only outbounds + routing (+ split-DNS
   * when ru-split). The result is a drop-in for the router's 04_outbounds +
   * 05_routing (+ 02_dns) files. All the REALITY/transport/balancer logic is
   * shared with the desktop xrayjson format.
   */
  forRouter?: boolean;
  /**
   * R3-b - raw custom xray routing rules (operator-authored), prepended ahead
   * of the preset rules + catch-all so they take precedence. Each entry is a
   * literal xray routing-rule object referencing the tags this builder emits
   * (`direct`, `block`, or a proxy tag). Empty/undefined = none.
   */
  customRules?: Record<string, unknown>[];
  /**
   * R3 - operator-defined custom domain lists (direct/proxy/block). Each
   * non-empty bucket becomes one field rule (domain array -> outboundTag),
   * slotted between the raw `customRules` and the preset rules. block wins over
   * direct/proxy on an overlapping domain (block rule is emitted first).
   * Empty/undefined = none = byte-identical output.
   */
  customDomainLists?: { direct: string[]; proxy: string[]; block: string[] };
  /**
   * TLS-fragment - when true, append a `freedom` outbound carrying a `fragment`
   * object and set `sockopt.dialerProxy` on every proxy outbound so the
   * ClientHello is split before it leaves the client. Default false keeps the
   * output byte-identical. Xray JSON only (the technique is Xray-native).
   */
  tlsFragment?: boolean;
}

// TLS-fragment defaults (upstream-verified). `tlshello` fragments the TLS
// handshake itself, which is what beats SNI-DPI.
const TLS_FRAGMENT_SETTINGS: Record<string, string> = {
  packets: 'tlshello',
  length: '100-200',
  interval: '10-20',
};

const RU_SPLIT_RULES: ReadonlyArray<Record<string, unknown>> = [
  { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
  {
    type: 'field',
    domain: ['geosite:category-ru', 'geosite:category-gov-ru'],
    outboundTag: 'direct',
  },
  { type: 'field', ip: ['geoip:private', 'geoip:ru'], outboundTag: 'direct' },
];

/**
 * Split DNS (R2). RU domains resolve via Yandex DNS (77.88.8.8) so RU CDNs
 * return geo-correct answers; `skipFallback` keeps those queries off the
 * general resolver. Everything else asks 8.8.8.8. Xray's built-in DNS obeys
 * the routing table above, so the 77.88.8.8 query itself rides direct
 * (matches geoip:ru) while 8.8.8.8 rides the tunnel - no plaintext foreign
 * DNS on the RU wire. Plain-IP servers dodge the DoH bootstrap problem
 * (resolving the resolver's own hostname).
 */
const RU_SPLIT_DNS: Record<string, unknown> = {
  servers: [
    {
      address: '77.88.8.8',
      domains: ['geosite:category-ru', 'geosite:category-gov-ru'],
      skipFallback: true,
    },
    '8.8.8.8',
  ],
};

/**
 * Routing Templates (H2) - `cn-split` is the China-direct mirror of `ru-split`.
 * China is comprehensively covered by the single `geosite:cn` / `geoip:cn`
 * category (no second gov category like RU), so one domain rule, not two.
 * Ads-block, private-range-direct and the catch-all stay identical in shape.
 */
const CN_SPLIT_RULES: ReadonlyArray<Record<string, unknown>> = [
  { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
  { type: 'field', domain: ['geosite:cn'], outboundTag: 'direct' },
  { type: 'field', ip: ['geoip:private', 'geoip:cn'], outboundTag: 'direct' },
];

/**
 * Split DNS (H2). China domains resolve via AliDNS (223.5.5.5) so CN CDNs
 * return geo-correct answers; `skipFallback` keeps those queries off the
 * general resolver. Everything else asks 8.8.8.8. Xray's built-in DNS obeys
 * the routing table above, so the 223.5.5.5 query itself rides direct
 * (matches geoip:cn) while 8.8.8.8 rides the tunnel - no plaintext foreign
 * DNS on the CN wire. Plain-IP server dodges the DoH bootstrap problem (the
 * same rationale as the Yandex IP in RU_SPLIT_DNS).
 */
const CN_SPLIT_DNS: Record<string, unknown> = {
  servers: [
    {
      address: '223.5.5.5',
      domains: ['geosite:cn'],
      skipFallback: true,
    },
    '8.8.8.8',
  ],
};

export function buildXrayJson(
  endpoints: SubscriptionEndpoint[],
  opts: XrayJsonBuildOpts = {},
): string {
  const xrayEps = endpoints.filter((e) => e.protocol === 'xray');
  const proxyTags: string[] = [];
  const bundle = opts.bundle ?? 'flat';
  // Routing preset (R1a + H2). Each split preset selects its own rule array +
  // split-DNS block; proxy-all leaves both null so the output stays
  // byte-identical to pre-R1 builds.
  const preset = opts.routingPreset ?? 'proxy-all';
  const splitRules =
    preset === 'ru-split'
      ? RU_SPLIT_RULES
      : preset === 'cn-split'
        ? CN_SPLIT_RULES
        : null;
  const splitDns =
    preset === 'ru-split'
      ? RU_SPLIT_DNS
      : preset === 'cn-split'
        ? CN_SPLIT_DNS
        : null;

  // TLS-fragment - the fragment outbound's tag must not collide with any proxy
  // (`${nodeName}-xray`), `direct`, or `block` tag, and must exactly equal the
  // dialerProxy value we stamp onto each proxy outbound. Prefer "fragment";
  // fall back to "tls-fragment" if some emitted outbound already owns the
  // "fragment" tag (defensive - keeps the guarantee even if the proxy tag
  // scheme ever changes to not carry the `-xray` suffix).
  const tlsFragment = opts.tlsFragment === true && xrayEps.length > 0;
  const reservedTags = new Set<string>(['direct', 'block']);
  for (const e of xrayEps) {
    if (e.protocol === 'xray') reservedTags.add(`${e.nodeName}-xray`);
  }
  const fragmentTag = reservedTags.has('fragment') ? 'tls-fragment' : 'fragment';

  const proxyOutbounds = xrayEps.map((e) => {
    if (e.protocol !== 'xray') throw new Error('unreachable'); // narrowing
    const tag = `${e.nodeName}-xray`;
    proxyTags.push(tag);
    const sub = e.subprotocol ?? 'vless';
    const network = e.network ?? 'raw';
    // securityLayer: 'default' = REALITY, else 'tls' (own cert) / 'none' (plain).
    const sec = e.securityLayer ?? 'default';
    const security = sec === 'default' ? 'reality' : sec;
    const useTls = sec !== 'none';

    // settings block by subprotocol.
    let settings: Record<string, unknown>;
    if (sub === 'trojan') {
      settings = { servers: [{ address: e.host, port: e.port, password: e.uuid }] };
    } else if (sub === 'vmess') {
      settings = {
        vnext: [
          { address: e.host, port: e.port, users: [{ id: e.uuid, security: 'auto', alterId: 0 }] },
        ],
      };
    } else {
      settings = {
        vnext: [
          {
            address: e.host,
            port: e.port,
            // Vision flow needs a TLS-like layer (reality or tls), not none.
            users: [{ id: e.uuid, encryption: 'none', ...(useTls && e.flow ? { flow: e.flow } : {}) }],
          },
        ],
      };
    }

    const streamSettings: Record<string, unknown> = { network, security };
    if (security === 'reality') {
      streamSettings.realitySettings = {
        publicKey: e.publicKey,
        shortId: e.shortId,
        serverName: e.sni,
        fingerprint: e.fingerprint,
        show: false,
        spiderX: '',
      };
    } else if (security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: e.sni,
        fingerprint: e.fingerprint,
        ...(e.alpn && e.alpn.length > 0 ? { alpn: e.alpn } : {}),
        ...(e.allowInsecure ? { allowInsecure: true } : {}),
      };
    }
    // transport-specific settings.
    if (network === 'ws') {
      streamSettings.wsSettings = {
        ...(e.path ? { path: e.path } : {}),
        ...(e.hostHeader ? { headers: { Host: e.hostHeader } } : {}),
      };
    } else if (network === 'httpupgrade') {
      streamSettings.httpupgradeSettings = {
        ...(e.path ? { path: e.path } : {}),
        ...(e.hostHeader ? { host: e.hostHeader } : {}),
      };
    } else if (network === 'xhttp') {
      streamSettings.xhttpSettings = {
        ...(e.path ? { path: e.path } : {}),
        ...(e.hostHeader ? { host: e.hostHeader } : {}),
        mode: 'auto',
      };
    } else if (network === 'grpc') {
      streamSettings.grpcSettings = { serviceName: e.serviceName ?? '' };
    } else if (network === 'kcp') {
      streamSettings.kcpSettings = { header: { type: 'none' } };
    }

    // TLS-fragment - dial this proxy THROUGH the fragment freedom outbound.
    // Merge into any existing sockopt so we never clobber other fields.
    if (tlsFragment) {
      const existingSockopt =
        (streamSettings.sockopt as Record<string, unknown> | undefined) ?? {};
      streamSettings.sockopt = { ...existingSockopt, dialerProxy: fragmentTag };
    }

    return {
      tag,
      protocol: sub === 'trojan' ? 'trojan' : sub === 'vmess' ? 'vmess' : 'vless',
      settings,
      streamSettings,
    };
  });

  // Slice 29 follow-up: when balancer is on AND we have ≥2 proxies, wrap
  // the proxy tags in an `observatory` probe + `balancer` selector. With
  // <2 proxies it's pointless (and the balancer block would still work but
  // probe one outbound, wasting bandwidth) so we fall through to flat mode.
  const balancerActive = bundle === 'balancer' && proxyTags.length >= 2;
  const observatory = balancerActive
    ? {
        subjectSelector: proxyTags,
        probeURL: opts.probeUrl ?? 'https://www.gstatic.com/generate_204',
        probeInterval: `${opts.probeIntervalSec ?? 300}s`,
      }
    : undefined;
  const balancers = balancerActive
    ? [{ tag: 'balancer-auto', selector: proxyTags, strategy: { type: 'leastPing' } }]
    : undefined;

  // R3 - operator custom domain lists -> one field rule per non-empty bucket.
  // Order block -> direct -> proxy so a block listing wins over a direct/proxy
  // listing of an overlapping domain. The proxy bucket needs an actual proxy
  // outbound to target; with no xray endpoints it is dropped (no valid tag).
  const cdl = opts.customDomainLists;
  const customDomainRules: Record<string, unknown>[] = cdl
    ? [
        ...(cdl.block.length ? [{ type: 'field', domain: cdl.block, outboundTag: 'block' }] : []),
        ...(cdl.direct.length ? [{ type: 'field', domain: cdl.direct, outboundTag: 'direct' }] : []),
        ...(cdl.proxy.length && proxyTags.length > 0
          ? [{ type: 'field', domain: cdl.proxy, outboundTag: proxyTags[0] }]
          : []),
      ]
    : [];

  // forRouter (XKeen): drop log + the client SOCKS inbound; the router owns
  // those. Keep dns (split presets), outbounds and routing.
  const config: Record<string, unknown> = {
    ...(opts.forRouter ? {} : { log: { loglevel: 'warning' } }),
    ...(splitDns ? { dns: splitDns } : {}),
    ...(opts.forRouter
      ? {}
      : {
          inbounds: [
            {
              tag: 'socks-in',
              port: 10808,
              listen: '127.0.0.1',
              protocol: 'socks',
              settings: { auth: 'noauth', udp: true },
            },
          ],
        }),
    outbounds: [
      ...proxyOutbounds,
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
      // TLS-fragment - the freedom dialer the proxy outbounds tunnel through.
      // Only appended when on, so the off path stays byte-identical.
      ...(tlsFragment
        ? [
            {
              tag: fragmentTag,
              protocol: 'freedom',
              settings: { fragment: { ...TLS_FRAGMENT_SETTINGS } },
            },
          ]
        : []),
    ],
    routing: {
      // Split presets need IPIfNonMatch so a domain-typed destination that
      // missed every domain rule gets a second, IP-based pass (otherwise
      // geoip:ru / geoip:cn never matches). proxy-all keeps AsIs.
      domainStrategy: splitRules ? 'IPIfNonMatch' : 'AsIs',
      ...(balancers ? { balancers } : {}),
      rules: [
        // R3-b custom rules win over presets + catch-all.
        ...(opts.customRules ?? []),
        // R3 custom domain lists sit below raw rules, above the preset rules.
        ...customDomainRules,
        ...(splitRules ?? []),
        balancerActive
          ? { type: 'field', network: 'tcp,udp', balancerTag: 'balancer-auto' }
          : proxyTags.length > 0
          ? { type: 'field', network: 'tcp,udp', outboundTag: proxyTags[0] }
          : { type: 'field', network: 'tcp,udp', outboundTag: 'direct' },
      ],
    },
  };
  if (observatory) config.observatory = observatory;
  return JSON.stringify(config, null, 2) + '\n';
}
