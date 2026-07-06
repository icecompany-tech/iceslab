/**
 * MTProto Telegram-proxy URI builder. Slice 41.
 *
 * Telegram clients accept two equivalent forms (both open the same
 * "Use this proxy?" dialog):
 *
 *   tg://proxy?server=<host>&port=<port>&secret=<hex>
 *   https://t.me/proxy?server=<host>&port=<port>&secret=<hex>
 *
 * The `https://t.me/proxy?...` form is preferred for distribution because
 * it works as a clickable link in any browser/messenger without the OS
 * needing to register the `tg://` scheme. The native `tg://` form opens
 * directly in the TG app on most mobile platforms.
 *
 * Secret format (Fake-TLS, the only mode current TG clients accept):
 *
 *   ee<16-byte-secret-hex><hex-encoded-domain>
 *
 *   - Leading byte `0xee` (`ee`) selects Fake-TLS mode.
 *   - 16-byte random secret (32 hex chars). Spec-mandated length, TG client
 *     rejects anything longer. Same length upstream `mtg generate-secret` emits.
 *   - Trailing bytes are the masquerade domain ASCII bytes hex-encoded.
 */

import { createHash } from 'node:crypto';

export interface MtprotoUriOpts {
  /** Hex-encoded `ee<32-bytes><domain-hex>` (use `mtprotoSecret()` to derive). */
  secret: string;
  host: string;
  port: number;
  /** Kept for backwards compatibility with the slice-41 signature. Telegram
   *  no longer accepts a `#fragment` on tg://proxy URIs, it returns
   *  "Некорректная ссылка на прокси" / "Invalid proxy link", so we don't
   *  append the name to the URI anymore. Caller still passes it; we ignore. */
  name: string;
}

/** Native deep-link form. Opens directly in the Telegram app. */
export function buildMtprotoUri(opts: MtprotoUriOpts): string {
  const params = new URLSearchParams({
    server: opts.host,
    port: String(opts.port),
    secret: opts.secret,
  });
  // No `#fragment`. Caught live 2026-05-20 on iOS Telegram: identical URI
  // with `#mtpro` appended → "Некорректная ссылка на прокси", same URI
  // without fragment → opens proxy dialog fine. Same as t.me/proxy form.
  return `tg://proxy?${params.toString()}`;
}

/**
 * Web-bouncer form: `https://t.me/proxy?...`. Works as a regular HTTP link
 * (clickable in any browser/messenger) and Telegram's t.me service
 * redirects to the in-app proxy dialog.
 *
 * No `#fragment`, t.me strips it.
 */
export function buildMtprotoTmeUri(
  opts: Omit<MtprotoUriOpts, 'name'>,
): string {
  const params = new URLSearchParams({
    server: opts.host,
    port: String(opts.port),
    secret: opts.secret,
  });
  return `https://t.me/proxy?${params.toString()}`;
}

/**
 * Derive a deterministic Fake-TLS MTProto secret for an inbound.
 *
 * Returns a hex string of the form:
 *   ee<32-hex-bytes-from-sha256(inboundId:domain)><hex-encoded-domain-ASCII>
 *
 * **Single-secret architecture (slice 41):** 9seconds/mtg upstream rejects
 * multi-secret support, one mtg instance == one secret. We follow that
 * constraint: secret is derived once per inbound, not per user. Every user
 * assigned to this inbound's squad receives the SAME URL.
 *
 * Inputs to the hash:
 *   - `inboundId` (UUID, stable across the inbound's lifetime)
 *   - `domain` (admin-changeable; change rotates the secret)
 *
 * Both panel and agent compute the identical value when given the same
 * (inboundId, domain) pair, so the panel can push a secret over the wire
 * and the agent can independently re-derive for verification.
 */
export function mtprotoSecret(inboundId: string, domain: string): string {
  // FakeTLS (`ee` prefix) wire format: 1-byte prefix + 16-byte random + hex
  // of the masquerade domain. Telegram's mtproto client (mobile + desktop)
  // strictly validates the 16-byte length and rejects 32-byte secrets with
  // "Некорректная ссылка на прокси" / "Invalid proxy link", same as
  // upstream `mtg generate-secret`. Caught live 2026-05-13 on iPhone test.
  const seed = `${inboundId}:${domain}`;
  const seedBytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16);
  const seedHex = seedBytes.toString('hex'); // 32 hex chars (16 bytes)
  const domainHex = Buffer.from(domain, 'utf8').toString('hex');
  return `ee${seedHex}${domainHex}`;
}
