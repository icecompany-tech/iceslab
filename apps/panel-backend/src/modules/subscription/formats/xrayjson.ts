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
 * default to vmess/vless — users who want Hysteria pick the Sing-box format
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
 * Slice 29 follow-up — Xray `observatory + balancer` for auto-failover.
 * When `bundle === 'balancer'`, we emit an `observatory` block that periodically
 * probes every proxy outbound, and route through a balancer-tagged tag that
 * picks the lowest-latency one. Default ('flat') keeps the legacy "first
 * outbound wins" routing rule for back-compat.
 */
/**
 * Routing Templates (R1a) - `routingPreset: 'ru-split'` prepends split-routing
 * rules ahead of the catch-all: ads/malware -> block, RU domains
 * (geosite:category-ru + category-gov-ru) and RU/private IPs -> direct,
 * everything else falls through to the tunnel. Uses the geosite:/geoip:
 * databases that ship inside every xray client install, so no extra files
 * are needed. `domainStrategy` switches to IPIfNonMatch so domains that miss
 * every domain rule get a second, IP-based pass (otherwise geoip:ru never
 * matches a domain-typed destination). Default 'proxy-all' keeps the output
 * byte-identical to pre-R1 builds.
 */
export interface XrayJsonBuildOpts {
  bundle?: 'flat' | 'balancer';
  probeUrl?: string;
  probeIntervalSec?: number;
  routingPreset?: RoutingPresetId;
}

const RU_SPLIT_RULES: ReadonlyArray<Record<string, unknown>> = [
  { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
  {
    type: 'field',
    domain: ['geosite:category-ru', 'geosite:category-gov-ru'],
    outboundTag: 'direct',
  },
  { type: 'field', ip: ['geoip:private', 'geoip:ru'], outboundTag: 'direct' },
];

export function buildXrayJson(
  endpoints: SubscriptionEndpoint[],
  opts: XrayJsonBuildOpts = {},
): string {
  const xrayEps = endpoints.filter((e) => e.protocol === 'xray');
  const proxyTags: string[] = [];
  const bundle = opts.bundle ?? 'flat';
  const ruSplit = (opts.routingPreset ?? 'proxy-all') === 'ru-split';

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

    return {
      tag,
      protocol: sub === 'trojan' ? 'trojan' : sub === 'vmess' ? 'vmess' : 'vless',
      settings,
      streamSettings,
    };
  });

  // Slice 29 follow-up — when balancer is on AND we have ≥2 proxies, wrap
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

  const config: Record<string, unknown> = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks-in',
        port: 10808,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      },
    ],
    outbounds: [
      ...proxyOutbounds,
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
    ],
    routing: {
      domainStrategy: ruSplit ? 'IPIfNonMatch' : 'AsIs',
      ...(balancers ? { balancers } : {}),
      rules: [
        ...(ruSplit ? RU_SPLIT_RULES : []),
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
