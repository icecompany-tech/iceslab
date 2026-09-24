import type { EngineName } from '@iceslab/shared';

/**
 * Each protocol keeps one accent across every screen it appears on. Brand
 * colours, outside the palette tokens by decision (CLAUDE.local.md). Lives in
 * `lib/ui` since the cascade card paints its core chips with it too, and
 * contours do not import each other; the profiles contour re-exports it.
 */
export const PROTOCOL_ACCENT: Record<string, string> = {
  xray: '#A78BFA',
  shadowsocks: '#F5A3B8',
  hysteria: '#7DD3FC',
  amneziawg: '#A7D8B9',
  naive: '#F5B14C',
  mtproto: '#67E8F9',
  socks5: '#67E8F9',
  http: '#F5B14C',
  // Telegram's own blue, and the only place the panel uses it.
  telegramweb: '#3AABEE',
  mieru: '#C78BFA',
  tuic: '#7DD3FC',
  anytls: '#7A8BA3',
  shadowtls: '#7A8BA3',
};

/** A core chip takes its protocol's accent; sing-box, which has no protocol
 *  of its own name, takes that of tuic, the protocol only it serves. */
export function engineAccent(engine: EngineName): string {
  return PROTOCOL_ACCENT[engine === 'singbox' ? 'tuic' : engine] ?? '#7A8BA3';
}
