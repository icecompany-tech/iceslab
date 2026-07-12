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
   * the profile MUST be a subset of the range install-iceslab-node.sh applied,
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
  security: z.enum(['reality', 'none', 'tls']).default('reality'),
  /** TLS (security='tls'): SNI the node serves + operator-supplied PEM cert
   *  chain and private key (embedded inline in the xray config; no ACME). The
   *  node's config.go validate() requires cert+key when security is 'tls'. */
  tlsServerName: z.string().max(253).optional(),
  tlsCert: z.string().max(16384).optional(),
  tlsKey: z.string().max(16384).optional(),
  /** Reject TLS handshakes whose SNI does not match a served server name.
   *  Hardens against probing; off by default to stay lenient for plain probes. */
  tlsRejectUnknownSni: z.boolean().default(false),
  /**
   * REALITY target: the legitimate site Xray forwards mismatched probes to.
   * Format `host:port`, e.g. "www.cloudflare.com:443". May be empty when
   * security is 'none'.
   */
  realityDest: z.string().regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/).or(z.literal('')).default(''),
  realityServerNames: z.array(z.string().min(1).max(255)).max(8).default([]),
  /** REALITY shortIds: hex strings, max 16 chars each. */
  realityShortIds: z
    .array(z.string().regex(/^[0-9a-fA-F]{0,16}$/))
    .max(8)
    .default([]),
  realityPrivateKey: z.string().max(128).default(''),
  /** REALITY public key paired with privateKey, emitted in client URI. */
  realityPublicKey: z.string().max(128).default(''),
  /** REALITY protocol version mirrored to the upstream TLS dest. 0 (default)
   *  is the conservative choice; 1/2 enable newer REALITY handshake variants. */
  realityXver: z.number().int().min(0).max(2).default(0),
  /** Max clock skew (ms) REALITY tolerates between client and node. 0 (default)
   *  leaves it at xray-core's built-in value; raise it for clients with drift. */
  realityMaxTimeDiff: z.number().int().min(0).max(600000).default(0),
  /** G - rate-limit unverified REALITY fallback connections, bytes/sec, 0 = off.
   *  Probe resistance: a scanner that fails REALITY auth is forwarded to the
   *  target throttled, so it sees a slow site instead of a full-speed proxy. */
  realityLimitFallbackUploadBytesPerSec: z.number().int().min(0).default(0),
  realityLimitFallbackDownloadBytesPerSec: z.number().int().min(0).default(0),
  /**
   * REALITY camouflage mode.
   *   - 'steal-others' (default): borrow an external site's TLS identity
   *     (realityDest points at a public host, e.g. a CDN).
   *   - 'self-steal': the node serves a local TLS fallback for its OWN domain;
   *     serverNames is overridden per-node with Node.domain at deploy time
   *     (see inbounds.queue + subscription.service).
   * MUST be declared here: Zod strips unknown keys, so without this field the
   * value is silently dropped when a profile is created/updated, the queue's
   * self-steal detection never fires, and the mode degrades to steal-others
   * (SNI != node IP -> RU-DPI mismatch). The wire DTO, node adapter, queue and
   * subscription all already read it; the schema was the missing link.
   */
  realityMode: z.enum(['steal-others', 'self-steal']).default('steal-others'),
  /** G1 realistic fallback (probe resistance). When set and realityMode is
   *  'self-steal', the node's local TLS fallback reverse-proxies probe requests
   *  to this real site instead of a stub page, so a deep prober sees genuine
   *  content. Empty = static landing page (the default). http(s) URL. */
  realityFallbackUpstream: z.string().url().max(512).or(z.literal('')).default(''),
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
   * but Vision is incompatible with `ws`/`grpc`, the adapter doesn't enforce
   * this at write time, the operator must align flow + network themselves.
   *
   * Slice 24c part 2 added `httpupgrade` (CDN-friendly, no WebSocket
   * handshake overhead) and `kcp` (UDP-based, useful on lossy networks).
   * `kcp` collides with Hysteria on the same UDP port, admin must avoid
   * port overlap manually (the panel doesn't cross-validate today).
   */
  network: z.enum(['raw', 'xhttp', 'ws', 'grpc', 'httpupgrade', 'kcp']).default('raw'),
  /** Path for `ws`, `xhttp`, `httpupgrade`. Default `/`. Ignored for `raw`/`grpc`/`kcp`. */
  path: z.string().max(255).optional(),
  /** Host header override for `ws`/`xhttp`/`httpupgrade`. Empty → use connect host. */
  host: z.string().max(255).optional(),
  /** gRPC serviceName. Required when network=grpc. */
  serviceName: z.string().max(64).optional(),
  /** XHTTP packet mode. 'auto' (default) lets xray pick; 'packet-up' /
   *  'stream-up' / 'stream-one' force a specific framing for tricky CDNs. */
  xhttpMode: z.enum(['auto', 'packet-up', 'stream-up', 'stream-one']).default('auto'),
  /** XHTTP request-padding byte range (e.g. "100-1000"). Empty disables
   *  padding; padding helps blur the packet-size signature under DPI. */
  xhttpPaddingBytes: z.string().max(32).default(''),
  /** gRPC multiMode. false (default) is single-stream; true multiplexes
   *  several gRPC streams per connection for better throughput. */
  grpcMultiMode: z.boolean().default(false),

  /**
   * Subprotocol carried over the same Xray binary + REALITY stack. Slice
   * 24c part 3:
   *   - `vless`   - canonical: per-user UUID, optional Vision flow
   *   - `trojan`  - per-user password (we reuse `user.xrayUuid` as the
   *                 password, UUID is high-entropy random and admins are
   *                 already managing it). No Vision flow on Trojan.
   * Same REALITY private/public key pair drives both, clients see the
   * difference only at the URI scheme level (`vless://` vs `trojan://`).
   *
   * Shadowsocks (SS2022) is deferred to a follow-up, multi-user model
   * differs (per-user keys + cipher selection) and benefits from its own
   * commit.
   */
  subprotocol: z.enum(['vless', 'trojan', 'vmess']).default('vless'),
});

// Bounds and defaults match upstream amnezia-vpn AmneziaWG v2.0 spec
// (docs.amnezia.org/documentation/amnezia-wg). Old TSPU presets from
// v1.5 era (Jmin=40, S1=72) are out of v2.0's accepted ranges and
// caused silent handshake failures with the current DKMS module
// (1.0.20251009, already v2.0-capable). Caught live cycle #6
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
  // H1-H4 replace the WG message-type marker; the node's config.go validate()
  // requires each > 4, pairwise distinct, and fitting a uint32. The cross-field
  // distinctness check lives in AmneziawgConfigSchema's superRefine below.
  h1: z.number().int().min(5).max(4294967295).default(100),
  h2: z.number().int().min(5).max(4294967295).default(200),
  h3: z.number().int().min(5).max(4294967295).default(300),
  h4: z.number().int().min(5).max(4294967295).default(400),
  // v2.0 mimicry packets: optional. Either plain hex OR an AmneziaWG 2.0 CPS
  // built from the tags `<b 0xHEX>` / `<r N>` / `<t>` (e.g. a QUIC-Initial
  // signature `<b 0xc00000000108><r 64><t>`). The whitelist (hex + `xX<> rt-`)
  // matches the node's validateIField and cannot form a newline/`[`/`=`/shell
  // metachar, so no INI/PostUp injection is possible. Empty = slot disabled.
  i1: z.string().regex(/^[0-9a-fA-FxX<> rt-]*$/).max(256).default(''),
  i2: z.string().regex(/^[0-9a-fA-FxX<> rt-]*$/).max(256).default(''),
  i3: z.string().regex(/^[0-9a-fA-FxX<> rt-]*$/).max(256).default(''),
  i4: z.string().regex(/^[0-9a-fA-FxX<> rt-]*$/).max(256).default(''),
  i5: z.string().regex(/^[0-9a-fA-FxX<> rt-]*$/).max(256).default(''),
});

export const AmneziawgConfigSchema = z
  .object({
    /** Subnet handed to peers, e.g. "10.0.0.0/24". */
    subnet: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/),
    serverPrivateKey: z.string().min(1).max(128),
    /** Public key paired with privateKey, emitted in client config. */
    serverPublicKey: z.string().min(1).max(128),
    obfuscation: ObfuscationSchema,
  })
  // Mirror the constraints the node's config.go validate() enforces at deploy
  // time, so the operator gets a clear form error instead of a confusing
  // "config push failed" after save. Refining this nested ZodObject is safe:
  // the InboundConfigByProtocol discriminated union keys off the top-level
  // `protocol` literal, not off this `config` member, so the refinement does
  // not interfere with discrimination.
  .superRefine((cfg, ctx) => {
    const { obfuscation } = cfg;
    // H1-H4 must be pairwise distinct (a repeated header value collapses two
    // packet types onto the same marker and breaks the obfuscation).
    const headers: Array<['h1' | 'h2' | 'h3' | 'h4', number]> = [
      ['h1', obfuscation.h1],
      ['h2', obfuscation.h2],
      ['h3', obfuscation.h3],
      ['h4', obfuscation.h4],
    ];
    for (let i = 0; i < headers.length; i++) {
      for (let j = i + 1; j < headers.length; j++) {
        if (headers[i][1] === headers[j][1]) {
          ctx.addIssue({
            code: 'custom',
            message: `H1-H4 must be pairwise distinct (${headers[i][0]} equals ${headers[j][0]})`,
            path: ['obfuscation', headers[j][0]],
          });
        }
      }
    }
    // s1 + 56 must NOT equal s2: that recreates the vanilla WireGuard handshake
    // packet length and makes the flow DPI-detectable.
    if (obfuscation.s1 + 56 === obfuscation.s2) {
      ctx.addIssue({
        code: 'custom',
        message: 's1 + 56 must not equal s2 (recreates the vanilla WireGuard handshake length, making the flow detectable)',
        path: ['obfuscation', 's2'],
      });
    }
  });

export const NaiveConfigSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+$/, 'No spaces / scheme, hostname only'),
  tlsEmail: z.string().email(),
  masqueradeRoot: z.string().min(1).max(255).default('/var/www/html'),
});

/**
 * Shadowsocks 2022 ciphers we expose. Slice 24d.
 *
 * Why a curated list rather than free-text:
 *   - SS2022 ciphers (`2022-blake3-aes-...`) require Xray ≥ v1.8 and use a
 *     pre-shared key model that's incompatible with the legacy AEAD
 *     ciphers, clients fail silently if mismatched.
 *   - Legacy AEAD (`chacha20-ietf-poly1305`, `aes-256-gcm`) work with every
 *     SS client back to ~2018, but are increasingly fingerprintable. We
 *     keep them for compat with old client builds.
 *   - Other ciphers (AES-CFB, RC4-MD5, etc) are insecure, explicitly
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
   * Server PSK: required by xray-core SS2022 at the `settings.password`
   * level. SS2022 multi-user model uses ServerPSK for the inbound itself
   * plus per-user PSK (per `clients[]` entry); clients connect with
   * `base64url(method:ServerPSK:UserPSK)` joined.
   *
   * For SS2022 ciphers the PSK MUST match the cipher's key length
   * (16 bytes for `2022-blake3-aes-128-gcm`, 32 bytes for the others)
   * encoded as base64. Auto-generated on inbound create when empty.
   *
   * Verified against XTLS/Xray-examples Shadowsocks-2022/README on
   * 2026-05-07: server-side `clients[]` requires `settings.password`.
   */
  serverPsk: z.string().min(1).max(128).optional(),
});

/**
 * MTProto Telegram-proxy config (slice 41). Uses `9seconds/mtg` server.
 *
 * Single tunable today: `domain`, the legitimate site mtg masquerades
 * as during Fake-TLS handshake. Any reachable, plausible site works
 * (`www.cloudflare.com`, `www.google.com`, etc). Changing domain rotates
 * every user's secret because the domain is hex-baked into each per-user
 * secret string, UI must warn before save.
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

/**
 * TUIC v5 config (sing-box engine, slice singbox-S2). `serverName` is the TLS
 * SNI the node's self-signed cert is issued for; the client connects with it
 * (+ allow-insecure for the alpha). `congestionControl` tunes the QUIC sender.
 */
export const TuicConfigSchema = z.object({
  serverName: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Hostname only (no scheme, no path)')
    .default('www.bing.com'),
  congestionControl: z.enum(['bbr', 'cubic', 'new_reno']).default('bbr'),
});

/**
 * AnyTLS config (sing-box engine). TCP+TLS, password-only (the password lives
 * on the user, derived from xrayUuid). serverName = TLS SNI for the node's
 * self-signed cert; client connects with it (+ allow-insecure in the alpha).
 */
export const AnytlsConfigSchema = z.object({
  serverName: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Hostname only (no scheme, no path)')
    .default('www.bing.com'),
});

/**
 * ShadowTLS v3 config (sing-box engine). TLS-camouflage wrapper: fronts a real
 * handshake to `handshake` (a whitelisted site) and detours to an inner single-key
 * shadowsocks. Per-user auth is the shadowtls password (derived from xrayUuid).
 * `ssPassword` is the inner ss server key - auto-generated on inbound create,
 * valid base64 of the cipher's key length (like Shadowsocks serverPsk).
 */
export const ShadowtlsConfigSchema = z.object({
  handshake: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Hostname only (no scheme, no path)')
    .default('www.microsoft.com'),
  ssMethod: ShadowsocksMethodSchema.default('2022-blake3-aes-128-gcm'),
  ssPassword: z.string().min(1).max(128).optional(),
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
  z.object({ protocol: z.literal('tuic'), config: TuicConfigSchema }),
  z.object({ protocol: z.literal('anytls'), config: AnytlsConfigSchema }),
  z.object({ protocol: z.literal('shadowtls'), config: ShadowtlsConfigSchema }),
]);

// Public-facing host the panel emits in client URIs. Must be a hostname or
// IP: RFC 1123 hostname or IPv4 dotted-quad. Length capped at 253 (RFC).
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
  // Slice 25: separate the public-facing client-URL host from the mTLS
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
// inbound's protocol, service.ts validates that before persisting.
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
  /** Protocol-specific config, must match the existing inbound's protocol. */
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
  tuic: TuicConfigSchema,
  anytls: AnytlsConfigSchema,
  shadowtls: ShadowtlsConfigSchema,
} as const;

export const ListInboundsQuerySchema = z.object({
  nodeId: z.uuid().optional(),
  protocol: z.enum(['hysteria', 'xray', 'amneziawg', 'naive', 'shadowsocks', 'mtproto', 'mieru', 'tuic', 'anytls', 'shadowtls']).optional(),
});
export type ListInboundsQuery = z.infer<typeof ListInboundsQuerySchema>;

export const InboundIdParamSchema = z.object({ id: z.uuid() });
export type InboundIdParam = z.infer<typeof InboundIdParamSchema>;
