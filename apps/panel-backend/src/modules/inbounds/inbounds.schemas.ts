import { z } from 'zod';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, underscore, hyphen');

const PortSchema = z.number().int().min(1).max(65535);

// ───── Per-protocol config schemas ─────

export const HysteriaConfigSchema = z.object({
  /** Optional Salamander obfuscation password. Leave empty for no obfs. */
  obfsPassword: z.string().max(128).optional(),
  /** Local URL Hysteria masquerades to for non-authenticated probers. */
  masqueradeUrl: z.string().url().optional(),
  /** Brutal CC up bandwidth in Mbps (server hint). */
  brutalUpMbps: z.number().int().positive().max(10000).optional(),
  /** Brutal CC down bandwidth in Mbps. */
  brutalDownMbps: z.number().int().positive().max(10000).optional(),
  /**
   * Port-hopping range (slice 31.5). When set, clients rotate destination
   * UDP port within `[start, end]` on each connection. Defeats RU TSPU /
   * IR / CN UDP/443 throttle that targets a single fixed port. Server still
   * listens on a single port (typically :443/udp); install-iceslab-node.sh sets up
   * iptables to REDIRECT the configured range → listen port. The range in
   * the profile MUST be a subset of the range install-iceslab-node.sh applied —
   * otherwise the redirect won't catch the rotating ports.
   *
   * Both fields must be set together (or both empty) and `end > start`.
   * Cross-field validation lives in `inbounds.service.ts` rather than as
   * a schema-level `.refine()` so this stays a plain `ZodObject` and can
   * participate in the InboundConfigByProtocol discriminated union.
   */
  portHoppingStart: z.number().int().min(1024).max(65535).optional(),
  portHoppingEnd: z.number().int().min(1024).max(65535).optional(),
});

export const XrayConfigSchema = z.object({
  /**
   * Stream security. 'reality' (default) or 'none' (plain transport, e.g.
   * ws/httpupgrade behind a CDN that terminates TLS, or local testing). The
   * reality* fields below are required only for 'reality' (the form enforces
   * that client-side and the node's config.go validate() rejects a reality
   * inbound with missing keys). Kept as a plain ZodObject (no .refine) so it
   * participates in the InboundConfigByProtocol discriminated union.
   */
  security: z.enum(['reality', 'none']).default('reality'),
  /**
   * REALITY target — the legitimate site Xray forwards mismatched probes to.
   * Format `host:port`, e.g. "www.cloudflare.com:443". May be empty when
   * security is 'none'.
   */
  realityDest: z.string().regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/).or(z.literal('')).default(''),
  realityServerNames: z.array(z.string().min(1).max(255)).max(8).default([]),
  /** REALITY shortIds — hex strings, max 16 chars each. */
  realityShortIds: z
    .array(z.string().regex(/^[0-9a-fA-F]{0,16}$/))
    .max(8)
    .default([]),
  realityPrivateKey: z.string().max(128).default(''),
  /** REALITY public key paired with privateKey — emitted in client URI. */
  realityPublicKey: z.string().max(128).default(''),
  // Mantine Select returns null when the empty option is picked. Coerce to
  // '' so the schema accepts the "no flow" choice the same way it accepts
  // 'xtls-rprx-vision'. Empty string is the canonical "no flow" wire value.
  flow: z
    .union([z.string(), z.null()])
    .transform((v) => v ?? '')
    .pipe(z.string().max(64))
    .default('xtls-rprx-vision'),
  fingerprint: z.string().max(32).default('chrome'),
  /**
   * Stream transport. v24.9.30 names: `raw` (was `tcp`), `xhttp` (was
   * `splithttp`). REALITY+Vision canonical is `raw`. `ws`/`grpc`/`xhttp` work
   * but Vision is incompatible with `ws`/`grpc` — the adapter doesn't enforce
   * this at write time, the operator must align flow + network themselves.
   *
   * Slice 24c part 2 added `httpupgrade` (CDN-friendly, no WebSocket
   * handshake overhead) and `kcp` (UDP-based, useful on lossy networks).
   * `kcp` collides with Hysteria on the same UDP port — admin must avoid
   * port overlap manually (the panel doesn't cross-validate today).
   */
  network: z.enum(['raw', 'xhttp', 'ws', 'grpc', 'httpupgrade', 'kcp']).default('raw'),
  /** Path for `ws`, `xhttp`, `httpupgrade`. Default `/`. Ignored for `raw`/`grpc`/`kcp`. */
  path: z.string().max(255).optional(),
  /** Host header override for `ws`/`xhttp`/`httpupgrade`. Empty → use connect host. */
  host: z.string().max(255).optional(),
  /** gRPC serviceName. Required when network=grpc. */
  serviceName: z.string().max(64).optional(),

  /**
   * Subprotocol carried over the same Xray binary + REALITY stack. Slice
   * 24c part 3:
   *   - `vless`   — canonical: per-user UUID, optional Vision flow
   *   - `trojan`  — per-user password (we reuse `user.xrayUuid` as the
   *                 password — UUID is high-entropy random and admins are
   *                 already managing it). No Vision flow on Trojan.
   * Same REALITY private/public key pair drives both — clients see the
   * difference only at the URI scheme level (`vless://` vs `trojan://`).
   *
   * Shadowsocks (SS2022) is deferred to a follow-up — multi-user model
   * differs (per-user keys + cipher selection) and benefits from its own
   * commit.
   */
  subprotocol: z.enum(['vless', 'trojan', 'vmess']).default('vless'),
});

// Bounds and defaults match upstream amnezia-vpn AmneziaWG v2.0 spec
// (docs.amnezia.org/documentation/amnezia-wg). Old TSPU presets from
// v1.5 era (Jmin=40, S1=72) are out of v2.0's accepted ranges and
// caused silent handshake failures with the current DKMS module
// (1.0.20251009 — already v2.0-capable). Caught live cycle #6
// 2026-05-13 after reading upstream docs.
//   - Jc: junk-packet count before handshake init     (0..10)
//   - Jmin/Jmax: junk-packet size range               (64..1024)
//   - S1/S2/S3: init/response/cookie padding bytes    (0..64)
//   - S4: data packet padding bytes                    (0..32)
//   - H1-H4: dynamic header bytes replacing WG type marker 1..4
//   - I1-I5: optional "mimicry" signature packets sent ahead of
//     handshake to disguise the flow as QUIC/DNS/etc. Hex strings;
//     empty disables the I-channel for that slot.
const ObfuscationSchema = z.object({
  jc: z.number().int().min(0).max(10).default(4),
  jmin: z.number().int().min(64).max(1024).default(64),
  jmax: z.number().int().min(64).max(1024).default(128),
  s1: z.number().int().min(0).max(64).default(32),
  s2: z.number().int().min(0).max(64).default(56),
  s3: z.number().int().min(0).max(64).default(32),
  s4: z.number().int().min(0).max(32).default(16),
  h1: z.number().int().min(5).default(100),
  h2: z.number().int().min(5).default(200),
  h3: z.number().int().min(5).default(300),
  h4: z.number().int().min(5).default(400),
  // Hex-encoded mimicry packets — optional, v2.0 feature. When empty,
  // the kernel module skips that slot. Each up to 256 hex chars
  // (128 bytes) per upstream guidance.
  i1: z.string().regex(/^[0-9a-fA-F]*$/).max(256).default(''),
  i2: z.string().regex(/^[0-9a-fA-F]*$/).max(256).default(''),
  i3: z.string().regex(/^[0-9a-fA-F]*$/).max(256).default(''),
  i4: z.string().regex(/^[0-9a-fA-F]*$/).max(256).default(''),
  i5: z.string().regex(/^[0-9a-fA-F]*$/).max(256).default(''),
});

export const AmneziawgConfigSchema = z.object({
  /** Subnet handed to peers, e.g. "10.0.0.0/24". */
  subnet: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/),
  serverPrivateKey: z.string().min(1).max(128),
  /** Public key paired with privateKey — emitted in client config. */
  serverPublicKey: z.string().min(1).max(128),
  obfuscation: ObfuscationSchema,
});

export const NaiveConfigSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+$/, 'No spaces / scheme — hostname only'),
  tlsEmail: z.string().email(),
  masqueradeRoot: z.string().min(1).max(255).default('/var/www/html'),
});

/**
 * Shadowsocks 2022 ciphers we expose. Slice 24d.
 *
 * Why a curated list rather than free-text:
 *   - SS2022 ciphers (`2022-blake3-aes-...`) require Xray ≥ v1.8 and use a
 *     pre-shared key model that's incompatible with the legacy AEAD
 *     ciphers — clients fail silently if mismatched.
 *   - Legacy AEAD (`chacha20-ietf-poly1305`, `aes-256-gcm`) work with every
 *     SS client back to ~2018, but are increasingly fingerprintable. We
 *     keep them for compat with old client builds.
 *   - Other ciphers (AES-CFB, RC4-MD5, etc) are insecure — explicitly
 *     omitted from the enum to prevent admin misconfiguration.
 */
export const ShadowsocksMethodSchema = z.enum([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'chacha20-ietf-poly1305',
  'aes-256-gcm',
  'aes-128-gcm',
]);

export const ShadowsocksConfigSchema = z.object({
  /** Cipher method. SS2022 (`2022-blake3-*`) recommended for new deployments. */
  method: ShadowsocksMethodSchema.default('2022-blake3-aes-256-gcm'),

  /**
   * Server PSK — required by xray-core SS2022 at the `settings.password`
   * level. SS2022 multi-user model uses ServerPSK for the inbound itself
   * plus per-user PSK (per `clients[]` entry); clients connect with
   * `base64url(method:ServerPSK:UserPSK)` joined.
   *
   * For SS2022 ciphers the PSK MUST match the cipher's key length
   * (16 bytes for `2022-blake3-aes-128-gcm`, 32 bytes for the others)
   * encoded as base64. Auto-generated on inbound create when empty.
   *
   * Verified against XTLS/Xray-examples Shadowsocks-2022/README on
   * 2026-05-07 — server-side `clients[]` requires `settings.password`.
   */
  serverPsk: z.string().min(1).max(128).optional(),
});

/**
 * MTProto Telegram-proxy config (slice 41). Uses `9seconds/mtg` server.
 *
 * Single tunable today: `domain` — the legitimate site mtg masquerades
 * as during Fake-TLS handshake. Any reachable, plausible site works
 * (`www.cloudflare.com`, `www.google.com`, etc). Changing domain rotates
 * every user's secret because the domain is hex-baked into each per-user
 * secret string — UI must warn before save.
 */
export const MtprotoConfigSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Hostname only (no scheme, no path)')
    .default('www.cloudflare.com'),
});

/**
 * Mieru stealth-proxy config (slice 40). Uses `enfein/mieru` server (`mita`).
 *
 * MTU is the only commonly-tuned knob. Default 1400 leaves headroom on
 * most paths; admins on PPPoE / weird VPNs may drop to 1280.
 */
export const MieruConfigSchema = z.object({
  mtu: z.number().int().min(576).max(1500).default(1400),
});

// Discriminated union over `protocol`. Used for create/update body validation.
export const InboundConfigByProtocol = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal('hysteria'), config: HysteriaConfigSchema }),
  z.object({ protocol: z.literal('xray'), config: XrayConfigSchema }),
  z.object({ protocol: z.literal('amneziawg'), config: AmneziawgConfigSchema }),
  z.object({ protocol: z.literal('naive'), config: NaiveConfigSchema }),
  z.object({ protocol: z.literal('shadowsocks'), config: ShadowsocksConfigSchema }),
  z.object({ protocol: z.literal('mtproto'), config: MtprotoConfigSchema }),
  z.object({ protocol: z.literal('mieru'), config: MieruConfigSchema }),
]);

// Public-facing host the panel emits in client URIs. Must be a hostname or
// IP — RFC 1123 hostname or IPv4 dotted-quad. Length capped at 253 (RFC).
const PublicHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
    'Must be a valid hostname or IPv4',
  );

const BaseFields = z.object({
  nodeId: z.uuid(),
  name: NameSchema,
  port: PortSchema,
  enabled: z.boolean().default(true),
  // Slice 25 — separate the public-facing client-URL host from the mTLS
  // control-plane endpoint (`node.address`). Empty string is treated like
  // null on the way in, so admins can clear the field in the UI.
  publicHost: PublicHostSchema.optional()
    .or(z.literal('').transform(() => undefined))
    .optional(),
  publicPort: PortSchema.optional(),
});

export const CreateInboundSchema = z.intersection(BaseFields, InboundConfigByProtocol);
export type CreateInboundInput = z.infer<typeof CreateInboundSchema>;

// Update never changes `protocol` (would invalidate per-protocol creds and
// break already-issued client URIs). To switch protocols, delete + recreate.
// The new config (if provided) must be the right shape for the existing
// inbound's protocol — service.ts validates that before persisting.
export const UpdateInboundSchema = z.object({
  name: NameSchema.optional(),
  port: PortSchema.optional(),
  enabled: z.boolean().optional(),
  // `null` explicitly clears the override; `undefined` (omitted) keeps the
  // current value. Empty string from a form input also clears.
  publicHost: PublicHostSchema.nullable()
    .or(z.literal('').transform(() => null))
    .optional(),
  publicPort: PortSchema.nullable().optional(),
  /** Protocol-specific config — must match the existing inbound's protocol. */
  config: z.unknown().optional(),
});
export type UpdateInboundInput = z.infer<typeof UpdateInboundSchema>;

export const PROTOCOL_CONFIG_SCHEMAS = {
  hysteria: HysteriaConfigSchema,
  xray: XrayConfigSchema,
  amneziawg: AmneziawgConfigSchema,
  naive: NaiveConfigSchema,
  shadowsocks: ShadowsocksConfigSchema,
  mtproto: MtprotoConfigSchema,
  mieru: MieruConfigSchema,
} as const;

export const ListInboundsQuerySchema = z.object({
  nodeId: z.uuid().optional(),
  protocol: z.enum(['hysteria', 'xray', 'amneziawg', 'naive', 'shadowsocks', 'mtproto', 'mieru']).optional(),
});
export type ListInboundsQuery = z.infer<typeof ListInboundsQuerySchema>;

export const InboundIdParamSchema = z.object({ id: z.uuid() });
export type InboundIdParam = z.infer<typeof InboundIdParamSchema>;
