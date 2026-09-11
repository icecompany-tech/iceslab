import type { User, UserTraffic } from '../../generated/prisma/client.js';
import type { EngineName, ProtocolName } from '@iceslab/shared';

// Re-export so existing imports keep working (slice 16 moved the
// implementation into core-adapters/hysteria, this file now hosts only
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
export { buildAnytlsUri, type AnytlsUriOpts } from '../../core-adapters/anytls/index.js';

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
  // suffix to strip, return it untouched rather than truncating at the
  // first colon.
  if (address.indexOf(':') !== address.lastIndexOf(':')) {
    return address;
  }
  // Plain `host:port` or bare host.
  const idx = address.indexOf(':');
  return idx === -1 ? address : address.slice(0, idx);
}

/**
 * Put a different name on an already-built share link.
 *
 * The label a user reads is only final once the WHOLE list is known: two rows
 * that read the same have to be told apart, and that cannot be decided while
 * the first of them is being built. Every URI is built inside the per-binding
 * loop, though, so until 2026-08-30 the plain list carried the name each row had
 * before the list was looked at - the panel showed two distinguishable rows and
 * the client showed two identical ones, which is precisely the shape the
 * operator reported on 2026-08-29.
 *
 * Every scheme we emit carries the name in the `#fragment`, except vmess, where
 * it is the `ps` field inside the base64 payload. Anything unparseable is
 * returned untouched: a link with a stale name still works, a link mangled by a
 * rewrite does not.
 */
export function withUriRemark(uri: string, remark: string): string {
  if (!uri) return uri;
  if (uri.startsWith('vmess://')) {
    try {
      const payload = JSON.parse(
        Buffer.from(uri.slice('vmess://'.length), 'base64').toString('utf-8'),
      ) as Record<string, unknown>;
      payload.ps = remark;
      return `vmess://${Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')}`;
    } catch {
      return uri;
    }
  }
  const hash = uri.indexOf('#');
  const base = hash === -1 ? uri : uri.slice(0, hash);
  return `${base}#${encodeURIComponent(remark)}`;
}

/**
 * Universal subscription body: base64 of newline-separated URIs. Works with
 * every mainstream client (NekoRay, Hiddify, v2rayN, ...).
 */
export function encodePlainList(uris: string[]): string {
  // Filter empty URIs: amneziawg endpoints don't have a URL form, so they
  // contribute nothing to the universal plain-list body. Clients that want
  // AmneziaWG fetch with `?format=wgconf`.
  const nonEmpty = uris.filter((u) => u.length > 0);
  return Buffer.from(nonEmpty.join('\n'), 'utf8').toString('base64');
}

interface SubscriptionEndpointBase {
  protocol: ProtocolName;
  /**
   * The CORE that serves this endpoint: the profile's pinned engine, or the
   * protocol's native one. Never a null to resolve downstream.
   *
   * A protocol name alone does not determine the link. Two cores speaking one
   * protocol do not speak the same dialect of it: xray's hysteria2 has no
   * Salamander obfuscation at all, so a link built for the native daemon and
   * handed to a client of an xray-served inbound makes that client obfuscate
   * into a server that does not deobfuscate, and the connection simply never
   * comes up. On the screen that reads as "the node is down".
   *
   * Optional only so an endpoint written by hand in a test stays valid; the
   * subscription service always sets it.
   */
  engine?: EngineName;
  /**
   * DISPLAY LABEL, not the node's name, whatever the field is called: it is
   * built by `subscriptionServerName` out of the flag, the host remark and the
   * node name, and a cascade entry emits several endpoints carrying different
   * labels off one node. Never join on it. `nodeId` below is the join key.
   */
  nodeName: string;
  /**
   * Node this endpoint is served from. Added 2026-07-31: the admin endpoints
   * view needed to show which of them are live, and the only other field that
   * looked like an identity was the label above, which is not one.
   */
  nodeId: string;
  /**
   * Stable identity of THIS endpoint, not of its node: the host row it is
   * emitted from. Survives renaming the node, the host and the country, which
   * the display label above does not. Formats derive their tags from it, see
   * `endpoint-identity.ts`.
   *
   * Optional only so an endpoint written out by hand (a test, a preview) stays
   * valid; `endpointKey` falls back to the tuple that identifies it in that
   * case. The subscription service always sets it.
   */
  key?: string;
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
  /** ALPN list: emitted by clash/singbox formatters when non-empty. */
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

  // ───── A4: route-profiles (exit x policy selection) ─────────────────
  /** When this endpoint's node is the ENTRY of an enabled balancer cascade, the
   *  route-PROFILES a user may pick there = (allowed exit) x (plain OR a granted
   *  ad-split policy). buildXrayJsonArray / expandEndpointUris expand one such
   *  endpoint into one standalone config per profile: same entry host, UUID bytes
   *  7-8 set to the profile's `tag` (xray reads them as `vlessRoute`, auth ignores
   *  them), remark = `label`. `tag` is computed by routeTag(policyOrdinal,
   *  exitIndex) so the entry node's routing rules and this UUID agree. `label` is
   *  the exit name (plain) or `exit · policy` (ad-split). Empty/undefined = a
   *  single plain config (the pre-A4 behaviour, non-balancer-entry endpoints).
   *  Only the xrayjson-array + plain formats consume this. */
  cascadeExits?: { label: string; tag: number; cascadeId?: string }[];
}

export interface HysteriaSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'hysteria';
  password: string;
  /** Salamander obfuscation password: present only when the inbound has
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
  /** UUID: used both as VLESS userId and (slice 24c part 3) as Trojan password. */
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
  /** Slice 24c part 3: controls URI scheme (`vless://` vs `trojan://`)
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
  /** Junk/header obfuscation parameters: must match the server inbound. */
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
  /** The masquerade domain: useful for non-URI formats that want it
   *  surfaced separately from the embedded hex. */
  domain: string;
  /** `https://t.me/proxy?...`: clickable in any browser/messenger. */
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

export interface AnytlsSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'anytls';
  /** Per-user password (derived from user.xrayUuid). */
  password: string;
  /** TLS SNI the node's self-signed cert is issued for. */
  serverName: string;
}

export interface ShadowtlsSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'shadowtls';
  /** Per-user ShadowTLS v3 password (derived from user.xrayUuid). */
  shadowtlsPassword: string;
  /** Camouflage handshake host the shadowtls layer fronts (also the SNI). */
  handshake: string;
  /** Inner shadowsocks cipher + server-wide key (the ss layer under shadowtls). */
  ssMethod: string;
  ssPassword: string;
}

export type SubscriptionEndpoint =
  | HysteriaSubscriptionEndpoint
  | XraySubscriptionEndpoint
  | AmneziawgSubscriptionEndpoint
  | NaiveSubscriptionEndpoint
  | ShadowsocksSubscriptionEndpoint
  | MtprotoSubscriptionEndpoint
  | MieruSubscriptionEndpoint
  | TuicSubscriptionEndpoint
  | AnytlsSubscriptionEndpoint
  | ShadowtlsSubscriptionEndpoint;

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
