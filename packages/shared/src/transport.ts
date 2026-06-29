/**
 * DTOs for the panel→node REST+mTLS API.
 *
 * These types are the wire-format contract. The Go node-agent reimplements
 * matching structs with json tags; the panel-backend imports them directly.
 *
 * Byte counts are typed as `number` for ergonomics — values comfortably fit
 * in a JS double for any realistic single-period traffic. Lifetime totals
 * may eventually need string encoding; revisit when quotas exceed ~8 PB.
 */

export type ProtocolName =
  | 'hysteria'
  | 'xray'
  | 'amneziawg'
  | 'naive'
  | 'shadowsocks'
  | 'mtproto'
  | 'mieru'
  | 'tuic'
  | 'anytls';

export interface ProtocolCredentials {
  hysteriaPassword?: string;
  xrayUuid?: string;
  naivePassword?: string;
  amneziawgPublicKey?: string;
  /**
   * IP allocated to this user inside the AmneziaWG inbound's subnet
   * (e.g. "10.0.0.42"). Panel-backend assigns it via the IP allocator
   * service before issuing the addUser request; node-agent writes it
   * straight into the [Peer] AllowedIPs field as `<ip>/32`.
   */
  amneziawgAllowedIp?: string;
  /** TUIC v5 (sing-box engine): per-user UUID + password. */
  tuicUuid?: string;
  tuicPassword?: string;
  /** AnyTLS (sing-box engine): per-user password (password-only auth). */
  anytlsPassword?: string;
}

// ───── POST /addUser ─────

export interface AddUserRequest {
  userId: string;
  shortId: string;
  username: string;
  credentials: ProtocolCredentials;
}

export interface AddUserResponse {
  ok: true;
}

// ───── POST /applyInbounds ─────
//
// Panel pushes the FULL set of inbounds bound to this node every time any
// inbound is created/updated/deleted (or the node itself is registered).
// Node-agent diffs against current state and regenerates the protocol's
// config file accordingly. Idempotent — re-sending the same set is a no-op.
//
// Replaces the manual `/etc/iceslab-node/env` editing that admins had to
// do before slice 24. The XRAY_REALITY_*  / HY_DOMAIN env vars stay
// supported as a fallback for nodes that haven't received their first
// applyInbounds yet (or for air-gapped setups).

/** Per-protocol inbound config — discriminated by `protocol`. The shape
 *  mirrors `apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts`
 *  but flattened (no Zod refinements). Panel sends, node decodes. */
export interface InboundDto {
  /** Stable UUID — node-agent uses it as the protocol-side `tag`. */
  id: string;
  /** Human-friendly name (becomes Xray inbound `tag`, Hysteria masquerade
   *  hint, etc — purely informational on the node side). */
  name: string;
  protocol: ProtocolName;
  /** Listen port (UDP for hysteria/awg, TCP for xray/naive). */
  port: number;
  /** Per-protocol settings. The discriminant is `protocol` above. */
  config:
    | XrayInboundCfg
    | HysteriaInboundCfg
    | AmneziawgInboundCfg
    | NaiveInboundCfg
    | ShadowsocksInboundCfg
    | MtprotoInboundCfg
    | MieruInboundCfg
    | TuicInboundCfg
    | AnytlsInboundCfg;
}

export interface XrayInboundCfg {
  /** Stream security. 'reality' (default), 'none' (plain transport, for
   *  ws/httpupgrade behind a CDN that terminates TLS, or local testing), or
   *  'tls' (node-terminated TLS with an operator-supplied certificate). The
   *  reality* fields are required only for 'reality'; the tls* fields only for
   *  'tls'. */
  security?: 'reality' | 'none' | 'tls';
  /** TLS (security='tls'): SNI / cert common name the node serves. */
  tlsServerName?: string;
  /** TLS cert chain (PEM). Operator-supplied; embedded inline in the xray
   *  config's tlsSettings.certificates (no ACME on the node). */
  tlsCert?: string;
  /** TLS private key (PEM), paired with tlsCert. */
  tlsKey?: string;
  /** Reject TLS handshakes whose SNI matches no served server name. */
  tlsRejectUnknownSni?: boolean;
  realityDest: string;            // e.g. "www.cloudflare.com:443"
  realityServerNames: string[];   // SNI candidates
  realityShortIds: string[];      // hex strings, 0..16 chars even-length
  realityPrivateKey: string;      // base64url (REALITY-style, NOT WireGuard base64)
  realityPublicKey: string;
  /** REALITY protocol version mirrored to the upstream dest (0|1|2). */
  realityXver?: number;
  /** Max client/node clock skew (ms) REALITY tolerates; 0 = xray default. */
  realityMaxTimeDiff?: number;
  /** G - throttle unverified REALITY fallback (probe) connections, bytes/sec; 0 = off. */
  realityLimitFallbackUploadBytesPerSec?: number;
  realityLimitFallbackDownloadBytesPerSec?: number;
  /** K9-B - how REALITY borrows a TLS identity:
   *   - 'steal-others' (default/empty): dest = an external camouflage site;
   *     works outside RU but SNI-IP-mismatches under RU-DPI.
   *   - 'self-steal': the node-agent runs a local TLS fallback and REALITY's
   *     dest points at it (127.0.0.1:8443), with serverNames = the node's own
   *     domain so SNI and IP stay consistent. Set serverNames to a domain that
   *     resolves to the node IP; the node ignores realityDest in this mode. */
  realityMode?: 'steal-others' | 'self-steal';
  /** G1 - real site the self-steal local TLS fallback reverse-proxies probe
   *  requests to (so a prober sees genuine content). Empty = static landing.
   *  Only used when realityMode is 'self-steal'. */
  realityFallbackUpstream?: string;
  flow: 'xtls-rprx-vision' | 'none';
  fingerprint: string;            // chrome / firefox / safari / etc
  network: 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';
  path?: string;                  // ws/xhttp/httpupgrade
  host?: string;                  // ws/xhttp/httpupgrade Host header override
  serviceName?: string;           // grpc
  /** XHTTP packet mode; 'auto' (default) lets xray pick the framing. */
  xhttpMode?: 'auto' | 'packet-up' | 'stream-up' | 'stream-one';
  /** XHTTP request-padding byte range (e.g. "100-1000"); empty disables. */
  xhttpPaddingBytes?: string;
  /** gRPC multiMode: multiplex several streams per connection. */
  grpcMultiMode?: boolean;
  /** Subprotocol carried by the xray inbound. `vless` (default) → per-user
   *  UUID with optional Vision flow; `trojan` → per-user password (we reuse
   *  user.xrayUuid); `vmess` → per-user UUID, AEAD (no flow). VMess pairs with
   *  security 'none'/'tls' only (its share link cannot carry REALITY). */
  subprotocol?: 'vless' | 'trojan' | 'vmess';
  /** C3 cascade chaining fragments for THIS node's hop. Generated panel-side
   *  by buildCascadeConfigs and merged into the node's xray config:
   *  link-in inbound (transit/exit nodes), link-out outbound (entry/transit
   *  nodes), and the per-role routing rules. Absent for plain (non-cascade)
   *  nodes, in which case the node renders exactly as before. */
  cascade?: XrayCascadeFragments;
}

/**
 * C3 cascade fragments: raw xray config objects the panel hands to a node so it
 * can chain entry→exit. The panel owns the exact xray shape (the node-agent
 * stays protocol-agnostic and just merges these into inbounds/outbounds/
 * routing.rules). Each element is a fully-formed xray config object.
 */
export interface XrayCascadeFragments {
  /** Link-IN inbounds (the previous hop dials these). Present on transit/exit
   *  nodes. */
  inbounds: unknown[];
  /** Link-OUT outbounds (this hop dials the next). Present on entry/transit
   *  nodes. */
  outbounds: unknown[];
  /** Per-role routing rules: entry routes user traffic → link-out; transit
   *  routes link-in → link-out; exit routes link-in → direct. Appended after
   *  the node's base block/DNS rules on the node side. */
  routingRules: unknown[];
  /** Inter-hop link-IN port this node listens on (the previous hop dials it).
   *  The node-agent opens UFW for it, restricted to linkAllowFrom, since this
   *  high port is not a top-level inbound and install-time rules miss it.
   *  Absent on the entry hop (no link-in). */
  linkIngressPort?: number;
  /** Source IP/CIDR/host allowed to reach linkIngressPort (the previous hop's
   *  address). Hostnames are resolved agent-side; empty → port opens to anyone
   *  (still UUID/PSK-gated). */
  linkAllowFrom?: string[];
}

export interface HysteriaInboundCfg {
  obfsPassword?: string;          // Salamander; empty = no obfuscation
  masqueradeUrl?: string;
  brutalUpMbps?: number;
  brutalDownMbps?: number;
}

export interface AmneziawgInboundCfg {
  /** Server WG private key (base64-standard, like `wg genkey`). */
  privateKey: string;
  /** Subnet in CIDR notation (e.g. "10.0.0.0/24"). Server takes .1, peers
   *  .2..N. Panel-side `amneziawg.service` does the per-user allocation. */
  subnet: string;
  /** AmneziaWG obfuscation params — see reference_amneziawg.md for ranges. */
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
  postUp?: string;                // optional iptables / sysctl tweaks
  postDown?: string;
}

export interface NaiveInboundCfg {
  hostname: string;               // public FQDN; Caddy ACME uses this
  tlsEmail: string;               // LE account
  masqueradeRoot?: string;        // dir served when probed (default: /var/www/empty)
}

/**
 * Shadowsocks 2022 inbound config (slice 24d). Method = AEAD/SS2022 cipher.
 * Per-user passwords are derived from `user.xrayUuid` on both sides — we
 * don't grow the credential surface for a fifth protocol.
 *
 * `serverPsk` (Server PSK) is auto-generated at inbound create on the
 * panel side and pushed over the wire. xray-core requires it at the
 * `settings.password` level for SS2022 multi-user; clients connect with
 * `base64url(method:ServerPSK:UserPSK)` joined.
 */
export interface ShadowsocksInboundCfg {
  method:
    | '2022-blake3-aes-128-gcm'
    | '2022-blake3-aes-256-gcm'
    | '2022-blake3-chacha20-poly1305'
    | 'chacha20-ietf-poly1305'
    | 'aes-256-gcm'
    | 'aes-128-gcm';
  serverPsk?: string;
}

/**
 * MTProto inbound config (slice 41). 9seconds/mtg upstream is single-
 * secret by design, so we model the inbound (not the user) as the unit
 * carrying the secret. The panel derives `secret` deterministically
 * from (inboundId, domain) and pushes it on the wire; the agent could
 * re-derive but trusts the panel's value to keep both sides in lock-step
 * even if the derivation logic ever changes.
 */
export interface MtprotoInboundCfg {
  domain: string;
  /** `ee<32-hex-bytes><hex-encoded-domain>` — Fake-TLS format. */
  secret: string;
}

/**
 * Mieru inbound config (slice 40). MTU caps the inner-payload size; per-
 * user creds derive from `user.xrayUuid`.
 */
export interface MieruInboundCfg {
  mtu: number;
}

/**
 * TUIC v5 inbound config (sing-box engine, slice singbox-S2). `serverName` is
 * the TLS SNI the node's cert is issued for; `congestionControl` tunes the QUIC
 * sender. TLS is the node's self-signed pair for the alpha (client connects
 * with allow-insecure + this SNI). Per-user uuid+password live in credentials.
 */
export interface TuicInboundCfg {
  serverName?: string;
  congestionControl?: 'bbr' | 'cubic' | 'new_reno';
}

/**
 * AnyTLS inbound config (sing-box engine). TCP+TLS, password-only auth (the
 * per-user password lives in credentials). `serverName` is the TLS SNI the
 * node's self-signed cert is issued for (client uses allow-insecure in alpha).
 */
export interface AnytlsInboundCfg {
  serverName?: string;
}

export interface ApplyInboundsRequest {
  inbounds: InboundDto[];
}

export interface ApplyInboundsResponse {
  ok: true;
  /** Number of inbounds actually applied (after the node-side diff). */
  applied: number;
  /** Number of inbounds that were already in this state (no-op). */
  skipped: number;
}

// ───── POST /removeUser ─────

export interface RemoveUserRequest {
  userId: string;
}

export interface RemoveUserResponse {
  ok: true;
}

// ───── GET /stats ─────

export interface UserStats {
  userId: string;
  bytesIn: number;
  bytesOut: number;
}

export interface GetStatsResponse {
  /**
   * Per-user counters. Cumulative since core start when `cumulative` is true
   * (the panel computes deltas against a stored snapshot); otherwise deltas
   * since the last poll (legacy agents).
   */
  users: UserStats[];
  /** Node uptime in seconds. */
  uptime: number;
  totalBytesIn: number;
  totalBytesOut: number;
  /**
   * #5 - true when `users[]` are cumulative-since-core-start (xray
   * non-destructive read). Absent/false = legacy already-deltas semantics.
   */
  cumulative?: boolean;
}

// ───── GET /healthz ─────

export interface CoreStatus {
  name: ProtocolName;
  running: boolean;
}

export interface HealthcheckResponse {
  status: 'ok' | 'degraded';
  cores: CoreStatus[];
}

// ───── GET /metrics ─────
//
// Host-level CPU / memory / disk for the VPS the node-agent runs on. Polled
// by the panel every 15s and cached in Redis with TTL 60s, so the dashboard
// can show per-node load without paying mTLS round-trip on every page open.

export interface CPUMetricsDto {
  /** Sampled CPU%, 0..100. Zero on the very first agent poll (no prior snapshot). */
  usagePercent: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cores: number;
}

export interface MemoryMetricsDto {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface DiskMetricsDto {
  path: string;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface HostMetricsResponse {
  cpu: CPUMetricsDto;
  memory: MemoryMetricsDto;
  disk: DiskMetricsDto;
  /** Node-agent process uptime, seconds. */
  uptimeSeconds: number;
  /** ISO 8601 with nanos. Useful for "stale sample" heuristics on the panel. */
  collectedAt: string;
}

// ───── GET /ufwPorts ─────
//
// G4 probe-exposure: the node-agent reports its ufw-allowed inbound ports; the
// panel compares them to the expected set (bindings + SSH + mTLS) and warns the
// operator about anything unexpected left open.

export interface UfwPortDto {
  port: number;
  proto: 'tcp' | 'udp';
}

export interface UfwPortsResponse {
  /** false = ufw not installed on the node; the panel skips the exposure check. */
  managed: boolean;
  ports: UfwPortDto[];
}

// ───── Common error shape ─────

export interface NodeErrorResponse {
  error: string;
  message: string;
}
