/**
 * What the operator types into the three Telegram cards the backend does not
 * know yet (SOCKS5, HTTP, WEB). The values live in the card's own state and
 * stop there: nothing here is a request body, and nothing is checked by the
 * server. The shapes follow docs/plan/telegram-ways-in.md.
 *
 * The WEB link is built exactly the way the reference relay documents it
 * (telegramdesktop/tproxy-server README, read 2026-09-23): `server` is the
 * hostname plus the base path, percent-encoded, with no scheme, port, query or
 * fragment; `secret` is the plain hex of the 16-byte secret, and with a base
 * path it becomes `0x70 || secret` in unpadded base64url.
 */

export const WEB_CARRIERS = ['https', 'https-lanes', 'websocket', 'websocket-lanes'] as const;
export type WebCarrier = (typeof WEB_CARRIERS)[number];

export interface TelegramDraft {
  socks5: { auth: 'password' | 'none'; port: number | ''; udp: boolean };
  http: { auth: 'basic' | 'none'; port: number | '' };
  web: { host: string; secret: string; path: string; carrier: WebCarrier };
}

/** UDP starts off: Telegram clients never use SOCKS5 UDP ASSOCIATE, their
 *  calls go through Telegram's own relays, so switching it on buys nothing. */
export const EMPTY_TELEGRAM_DRAFT: TelegramDraft = {
  socks5: { auth: 'password', port: '', udp: false },
  http: { auth: 'basic', port: '' },
  web: { host: '', secret: '', path: '', carrier: 'https' },
};

const SECRET_BYTES = 16;
const HEX_SECRET = /^[0-9a-f]{32}$/i;
// A domain with at least one dot. A scheme, port, path or query is exactly what
// the `server` parameter must not carry, so any of them fails here.
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** A fresh 16-byte secret as 32 hex characters. Made in the browser: the
 *  backend has no endpoint for it, and a secret needs no server to be random. */
export function generateWebSecret(
  fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const bytes = fill(new Uint8Array(SECRET_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type WebLinkFacts =
  | { kind: 'link'; link: string }
  /** Nothing wrong yet, something required is still empty. */
  | { kind: 'wait'; missing: Array<'host' | 'secret'> }
  /** The first field that would make a link Telegram cannot use. */
  | { kind: 'bad'; field: 'host' | 'secret' | 'path' };

export function webLinkFacts(web: { host: string; secret: string; path: string }): WebLinkFacts {
  const host = web.host.trim();
  const secret = web.secret.trim();
  const segments = web.path.trim().split('/').filter((s) => s !== '');

  if (host !== '' && !HOSTNAME.test(host)) return { kind: 'bad', field: 'host' };
  if (secret !== '' && !HEX_SECRET.test(secret)) return { kind: 'bad', field: 'secret' };
  if (segments.some((s) => !PATH_SEGMENT.test(s))) return { kind: 'bad', field: 'path' };

  const missing: Array<'host' | 'secret'> = [];
  if (host === '') missing.push('host');
  if (secret === '') missing.push('secret');
  if (missing.length > 0) return { kind: 'wait', missing };

  const hex = secret.toLowerCase();
  const server = segments.length > 0 ? `${host.toLowerCase()}/${segments.join('/')}` : host.toLowerCase();
  const encoded = segments.length > 0 ? pathSecret(hex) : hex;
  return {
    kind: 'link',
    link: `https://t.me/webproxy?server=${encodeURIComponent(server)}&secret=${encoded}`,
  };
}

/** `0x70 || secret`, unpadded base64url: the form the secret takes once a base
 *  path is part of the address. */
function pathSecret(hex: string): string {
  const bytes = [0x70, ...(hex.match(/../g) ?? []).map((h) => parseInt(h, 16))];
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
