/**
 * Shadowsocks URI builder. Slice 24d.
 *
 * SIP002 wire format (consumed by Shadowsocks-android, Shadowrocket,
 * Outline, NekoBox, Hiddify, etc):
 *
 *   ss://<base64url(method:password)>@<host>:<port>#<fragment>
 *
 * The `method:password` tuple is base64url-encoded WITHOUT padding to keep
 * it URL-safe (the original SIP002 spec used base64-standard, but every
 * modern client tolerates base64url and several reject `+/=` in the
 * userinfo segment).
 *
 * **SS2022 multi-user PSK format** (verified against XTLS/Xray-examples
 * Shadowsocks-2022/README.ENG.md on 2026-05-07): the `password` part of
 * the URI is the colon-joined `<ServerPSK>:<UserPSK>`. Server PSK is the
 * inbound-level secret (xray's `settings.password`); User PSK is the
 * per-client `clients[i].password`. Single-tenant SS (no `clients[]`) is
 * a degenerate case where you'd just pass UserPSK alone, pass empty
 * `serverPsk` here and we'll skip the colon prefix.
 *
 * Legacy AEAD ciphers (`aes-256-gcm`, `chacha20-ietf-poly1305`) work with
 * just one password, pass the user's PSK as `userPsk`, leave
 * `serverPsk` empty.
 */

export type ShadowsocksMethod =
  | '2022-blake3-aes-128-gcm'
  | '2022-blake3-aes-256-gcm'
  | '2022-blake3-chacha20-poly1305'
  | 'chacha20-ietf-poly1305'
  | 'aes-256-gcm'
  | 'aes-128-gcm';

export interface ShadowsocksUriOpts {
  method: ShadowsocksMethod;
  /** Per-user PSK. */
  userPsk: string;
  /** Inbound-level Server PSK (SS2022 multi-user). Empty → single-tenant
   *  format (legacy AEAD or single-user SS2022). */
  serverPsk?: string;
  host: string;
  port: number;
  /** URL fragment shown in clients (typically the node name). */
  name: string;
}

export function buildShadowsocksUri(opts: ShadowsocksUriOpts): string {
  // SS2022 multi-user: `<method>:<ServerPSK>:<UserPSK>` joined with colons.
  // Single-tenant: `<method>:<UserPSK>` (no server PSK).
  const password = opts.serverPsk
    ? `${opts.serverPsk}:${opts.userPsk}`
    : opts.userPsk;
  const userinfo = base64UrlNoPad(`${opts.method}:${password}`);
  return `ss://${userinfo}@${opts.host}:${opts.port}#${encodeURIComponent(opts.name)}`;
}

/** base64url without padding, the URI-safe encoding clients expect. */
function base64UrlNoPad(input: string): string {
  // Node 22 has Buffer; tests run under Vitest+Node, panel runs under Node.
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
