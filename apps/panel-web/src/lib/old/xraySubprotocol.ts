import { XRAY_PLAIN_SUBPROTOCOLS } from '@iceslab/shared';

/**
 * SOCKS5 and HTTP on the xray core, as the whole panel names them.
 *
 * They are xray profiles told apart only by `config.subprotocol`, so every
 * screen that names a profile by its protocol would call them "Xray". This is
 * the one place that knows otherwise; the profiles contour builds its form and
 * defaults on top of it (contours/profiles/lib/plainSubprotocol.ts).
 */

export type PlainSubprotocol = (typeof XRAY_PLAIN_SUBPROTOCOLS)[number];

export function isPlainSubprotocol(s: unknown): s is PlainSubprotocol {
  return (XRAY_PLAIN_SUBPROTOCOLS as readonly unknown[]).includes(s);
}

/** Which of the two a saved profile is, or `null` for every other profile. */
export function plainSubprotocolOf(
  profile: { protocol: string; config?: unknown } | null | undefined,
): PlainSubprotocol | null {
  if (!profile || profile.protocol !== 'xray') return null;
  const sub = (profile.config as { subprotocol?: unknown } | null | undefined)?.subprotocol;
  return isPlainSubprotocol(sub) ? sub : null;
}

/** The name a person knows it by: nobody calls a SOCKS5 proxy "xray". */
export const PLAIN_LABEL: Record<PlainSubprotocol, string> = { socks: 'SOCKS5', http: 'HTTP' };
