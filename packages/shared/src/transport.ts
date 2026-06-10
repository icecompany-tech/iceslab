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
  | 'mieru';

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
    | MieruInboundCfg;
}

export interface XrayInboundCfg {
  /** Stream security. 'reality' (default) or 'none' (plain transport, for
   *  ws/httpupgrade behind a CDN that terminates TLS, or local testing). The
   *  reality* fields below are required only when security is 'reality'. A
   *  later step adds node-terminated 'tls'. */
  security?: 'reality' | 'none';
  realityDest: string;            // e.g. "www.cloudflare.com:443"
  realityServerNames: string[];   // SNI candidates
  realityShortIds: string[];      // hex strings, 0..16 chars even-length
  realityPrivateKey: string;      // base64url (REALITY-style, NOT WireGuard base64)
  realityPublicKey: string;
  flow: 'xtls-rprx-vision' | 'none';
  fingerprint: string;            // chrome / firefox / safari / etc
  network: 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';
  path?: string;                  // ws/xhttp/httpupgrade
  host?: string;                  // ws/xhttp/httpupgrade Host header override
  serviceName?: string;           // grpc
  /** Subprotocol carried by the xray inbound. `vless` (default) → per-user
   *  UUID with optional Vision flow; `trojan` → per-user password (we reuse
   *  user.xrayUuid); `vmess` → per-user UUID, AEAD (no flow). VMess pairs with
   *  security 'none'/'tls' only (its share link cannot carry REALITY). */
  subprotocol?: 'vless' | 'trojan' | 'vmess';
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
  /** Per-user counters since the last poll. */
  users: UserStats[];
  /** Node uptime in seconds. */
  uptime: number;
  totalBytesIn: number;
  totalBytesOut: number;
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

// ───── Common error shape ─────

export interface NodeErrorResponse {
  error: string;
  message: string;
}
