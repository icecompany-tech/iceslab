import type { User, UserTraffic } from '../../generated/prisma/client.js';
import type { ProtocolName } from '@iceslab/shared';

// Re-export so existing imports keep working (slice 16 moved the
// implementation into core-adapters/hysteria — this file now hosts only
// the format-level helpers that are not protocol-specific).
export { buildHysteriaUri, type HysteriaUriOpts } from '../../core-adapters/hysteria/index.js';
export {
  buildVlessRealityUri,
  type VlessRealityUriOpts,
  buildTrojanRealityUri,
  type TrojanRealityUriOpts,
  buildVmessUri,
  type VmessUriOpts,
} from '../../core-adapters/xray/index.js';
export {
  buildShadowsocksUri,
  type ShadowsocksUriOpts,
  type ShadowsocksMethod,
} from '../../core-adapters/shadowsocks/index.js';
export {
  buildMtprotoUri,
  buildMtprotoTmeUri,
  mtprotoSecret,
  type MtprotoUriOpts,
} from '../../core-adapters/mtproto/index.js';
export {
  buildMieruUri,
  buildMieruProfileJson,
  type MieruUriOpts,
  type MieruProfileOpts,
  type MieruProfileJson,
} from '../../core-adapters/mieru/index.js';
export { buildTuicUri, type TuicUriOpts } from '../../core-adapters/tuic/index.js';

/**
 * Strip the optional `:port` suffix from a `host[:port]` string, returning the
 * host. IPv6-aware: a bare `indexOf(':')` split mangled `2001:db8::1` into
 * `2001`. Handles bracketed (`[::1]:443`) and bare (`2001:db8::1`) IPv6.
 */
export function hostFromAddress(address: string): string {
  // Bracketed IPv6: `[::1]` or `[::1]:443` → return the bracketed host.
  if (address.startsWith('[')) {
    const close = address.indexOf(']');
    return close === -1 ? address : address.slice(0, close + 1);
  }
  // Bare IPv6 (more than one colon, no brackets) has no unambiguous port
  // suffix to strip — return it untouched rather than truncating at the
  // first colon.
  if (address.indexOf(':') !== address.lastIndexOf(':')) {
    return address;
  }
  // Plain `host:port` or bare host.
  const idx = address.indexOf(':');
  return idx === -1 ? address : address.slice(0, idx);
}

/**
 * Universal subscription body: base64 of newline-separated URIs. Works with
 * every mainstream client (NekoRay, Hiddify, v2rayN, ...).
 */
export function encodePlainList(uris: string[]): string {
  // Filter empty URIs — amneziawg endpoints don't have a URL form, so they
  // contribute nothing to the universal plain-list body. Clients that want
  // AmneziaWG fetch with `?format=wgconf`.
  const nonEmpty = uris.filter((u) => u.length > 0);
  return Buffer.from(nonEmpty.join('\n'), 'utf8').toString('base64');
}

interface SubscriptionEndpointBase {
  protocol: ProtocolName;
  nodeName: string;
  /** Public host the client connects to (no port). */
  host: string;
  /** Public port the client connects to. */
  port: number;
  /** Pre-built URI for plain-list/JSON formats. Format-specific builders
   *  (Clash, Sing-box, ...) consume the structured fields below instead. */
  uri: string;

  // ───── Slice 30: per-host metadata ──────────────────────────────────
  // Each binding can fan out into N hosts. The fields below identify
  // which host produced this endpoint and carry overrides that aren't
  // baked into `uri` yet (slice 30.1 will light up emission).

  /** Host row id this endpoint was emitted from. Undefined for legacy
   *  bindings that have zero hosts (back-compat fallback). */
  hostId?: string;
  /** Admin-facing label of the originating host. Useful for debugging
   *  why a particular URL appears in the subscription. */
  hostRemark?: string;
  /** ALPN list — emitted by clash/singbox formatters when non-empty. */
  alpn?: string[];
  /** `?allowInsecure=1` flag for self-signed CDN front. */
  allowInsecure?: boolean;
  /** Forces client-side TLS layer when the host fronts the inbound through
   *  a CDN that terminates TLS. `default` keeps adapter behaviour. */
  securityLayer?: 'default' | 'tls' | 'none';
  /** Subscription formats this endpoint must NOT be emitted in. The route
   *  handler filters by this before invoking the format-specific formatter,
   *  so each formatter can stay format-agnostic. */
  disableForFormats?: string[];
}

export interface HysteriaSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'hysteria';
  password: string;
  /** Salamander obfuscation password — present only when the inbound has
   *  `obfsPassword` set. Critical on RU/IR/CN ISPs that DPI-throttle bare QUIC. */
  obfsPassword?: string;
  /** Brutal CC bandwidth declaration in Mbps. Forwarded into URI / singbox
   *  / clash output so the client negotiates a non-zero send window. See
   *  HysteriaUriOpts.upMbps for the gory detail. */
  upMbps?: number;
  downMbps?: number;
  /** Port-hopping range (slice 31.5). When set, URI emits `mport=`, sing-box
   *  emits `server_ports`, and Clash Meta emits `ports`. The server-side
   *  iptables redirect (configured at install-node time) must cover at
   *  least this range for the rotating ports to actually reach hysteria. */
  portHoppingStart?: number;
  portHoppingEnd?: number;
}

export interface XraySubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'xray';
  /** UUID — used both as VLESS userId and (slice 24c part 3) as Trojan password. */
  uuid: string;
  publicKey: string;
  shortId: string;
  sni: string;
  flow: string;
  fingerprint: string;
  network: 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';
  path?: string;
  hostHeader?: string;
  serviceName?: string;
  /** Slice 24c part 3 — controls URI scheme (`vless://` vs `trojan://`)
   *  and downstream singbox/clash outbound type. */
  subprotocol?: 'vless' | 'trojan' | 'vmess';
}

export interface AmneziawgSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'amneziawg';
  /** User's WireGuard private key. */
  privateKey: string;
  /** IP allocated to this user inside the inbound's subnet, CIDR /32 form. */
  allowedIp: string;
  /** Server's WireGuard public key (the inbound's interface PublicKey). */
  serverPublicKey: string;
  /** Junk/header obfuscation parameters — must match the server inbound. */
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  /** I1-I5 mimicry packets (hex, v2.0). Empty = disabled for that slot. */
  i1: string;
  i2: string;
  i3: string;
  i4: string;
  i5: string;
}

export interface NaiveSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'naive';
  username: string;
  password: string;
}

export interface ShadowsocksSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'shadowsocks';
  /** SS2022 / legacy AEAD cipher. Drives the URI's method tuple and the
   *  outbound shape in sing-box / Clash formatters. */
  method:
    | '2022-blake3-aes-128-gcm'
    | '2022-blake3-aes-256-gcm'
    | '2022-blake3-chacha20-poly1305'
    | 'chacha20-ietf-poly1305'
    | 'aes-256-gcm'
    | 'aes-128-gcm';
  password: string;
}

export interface MtprotoSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'mtproto';
  /** Per-user Fake-TLS secret (hex, `ee<32-bytes><domain-hex>`). */
  secret: string;
  /** The masquerade domain — useful for non-URI formats that want it
   *  surfaced separately from the embedded hex. */
  domain: string;
  /** `https://t.me/proxy?...` — clickable in any browser/messenger. */
  tmeUri: string;
}

export interface MieruSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'mieru';
  username: string;
  password: string;
  mtu: number;
}

export interface TuicSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'tuic';
  /** UUID (reuses user.xrayUuid) and derived password. */
  uuid: string;
  password: string;
  /** TLS SNI the node's self-signed cert is issued for. */
  serverName: string;
  /** Congestion controller: bbr | cubic | new_reno. */
  congestionControl: string;
}

export type SubscriptionEndpoint =
  | HysteriaSubscriptionEndpoint
  | XraySubscriptionEndpoint
  | AmneziawgSubscriptionEndpoint
  | NaiveSubscriptionEndpoint
  | ShadowsocksSubscriptionEndpoint
  | MtprotoSubscriptionEndpoint
  | MieruSubscriptionEndpoint
  | TuicSubscriptionEndpoint;

export interface SubscriptionJsonResponse {
  user: {
    id: string;
    shortId: string;
    username: string;
    status: string;
    expireAt: string | null;
    trafficLimitBytes: number | null;
    trafficUsedBytes: number;
  };
  endpoints: SubscriptionEndpoint[];
}

/**
 * Structured JSON for IcePath-VPN Mini-App (Go) and Ice-Client (Rust).
 * Includes user-state metadata so clients can show quota/expiry without a
 * second request.
 */
export function buildSubscriptionJson(
  user: User & { traffic: UserTraffic | null },
  endpoints: SubscriptionEndpoint[],
): SubscriptionJsonResponse {
  return {
    user: {
      id: user.id,
      shortId: user.shortId,
      username: user.username,
      status: user.status,
      expireAt: user.expireAt ? user.expireAt.toISOString() : null,
      trafficLimitBytes:
        user.trafficLimitBytes !== null ? Number(user.trafficLimitBytes) : null,
      trafficUsedBytes: user.traffic ? Number(user.traffic.usedTrafficBytes) : 0,
    },
    endpoints,
  };
}
