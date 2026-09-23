import { plainSubprotocolOf, type PlainSubprotocol } from '@/lib/domain/xraySubprotocol';

// The naming half lives in lib/domain, where every screen can read it; the
// form half stays here.
export {
  isPlainSubprotocol,
  plainSubprotocolOf,
  PLAIN_LABEL,
  type PlainSubprotocol,
} from '@/lib/domain/xraySubprotocol';

/**
 * SOCKS5 and HTTP on the xray core: the Telegram entries
 * (docs/plan/telegram-ways-in.md, section 9).
 *
 * They are xray subprotocols with nothing to choose on the wire: no TLS, no
 * REALITY, no transport, because Telegram's clients dial them as plain SOCKS5
 * and HTTP CONNECT over TCP. The server refuses any other security or network
 * for them, so the form sends exactly the three keys the contract allows and
 * nothing left over from a vless draft. Authentication has no field either:
 * it is always the users' own accounts (username and xray UUID).
 */

/** 1080 and 3128 are what clients and people expect; 8080 is not offered
 *  because the node's xray API sits there (ARCH, 2026-09-23). */
const PLAIN_DEFAULT_PORT: Record<PlainSubprotocol, number> = { socks: 1080, http: 3128 };

export function plainXrayConfig(subprotocol: PlainSubprotocol) {
  return { subprotocol, security: 'none', network: 'raw' } as const;
}

/**
 * Did the server refuse the profile's ENGINE? A 400 whose issues point at
 * `engine`: a socks or http profile sent to sing-box, or any protocol sent to
 * an engine that does not run it. The screen never offers either pair, so this
 * shows up only when something else built the request, and then the operator
 * should read what was wrong rather than axios's "status code 400".
 * `false` for anything else, including a missing or odd error.
 */
export function engineRefused(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400) return false;
  const issues = (res.data as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return false;
  return issues.some(
    (i) => Array.isArray((i as { path?: unknown })?.path) && (i as { path: unknown[] }).path[0] === 'engine',
  );
}

/**
 * The port a new binding of this profile starts with, when the profile has
 * an opinion. `null` for everything else: those keep the server's free-port
 * suggestion. The per-node port check still judges the value either way.
 */
export function plainDefaultPort(
  profile: { protocol: string; config?: unknown } | null | undefined,
): number | null {
  const sub = plainSubprotocolOf(profile);
  return sub ? PLAIN_DEFAULT_PORT[sub] : null;
}
