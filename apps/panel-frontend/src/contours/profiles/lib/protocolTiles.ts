export type EngineTab = 'native' | 'xray' | 'singbox' | 'telegram';

export function engineTabOf(protocol: string, engine: 'native' | 'singbox'): EngineTab {
  // MTProto answers a different question from its neighbours. The other three
  // tabs sort by which binary runs on the node; this one sorts by what the
  // Telegram client itself offers in its settings, and MTProto is the entry we
  // already speak. It still runs its own daemon, it just stops being filed
  // next to Hysteria, where nobody looking for Telegram would find it.
  if (protocol === 'mtproto') return 'telegram';
  if (engine === 'singbox') return 'singbox';
  return protocol === 'xray' || protocol === 'shadowsocks' ? 'xray' : 'native';
}

/** One line per protocol: what it speaks, in the operator's terms. */
export const PROTOCOL_TILE_HINT: Record<string, string> = {
  xray: 'VLESS, VMess, Trojan, REALITY',
  hysteria: 'QUIC, Brutal CC, port hopping',
  shadowsocks: 'blake3 ciphers, minimal overhead',
  amneziawg: 'WireGuard with obfuscation',
  naive: 'Chromium TLS, Caddy fork',
  mtproto: "Telegram's own, fake-TLS",
  socks5: 'Any client speaks it, not only Telegram',
  http: 'CONNECT tunnel, TCP only',
  telegramweb: 'MTProxy through a WebView over HTTPS',
  mieru: 'Stealth proxy, no handshake',
  'xray#singbox': 'VLESS, VMess, Trojan',
  'hysteria#singbox': 'Same protocol, one less process',
  'shadowsocks#singbox': '2022 ciphers, sing-box core',
  tuic: 'QUIC-based, UDP relay',
  anytls: 'TLS-in-TLS, padding scheme',
  shadowtls: 'Handshake proxied to a real site',
};

/** Tile titles drop the engine suffix: the active tab already said it. */
export const PROTOCOL_TILE_LABEL: Record<string, string> = {
  xray: 'Xray',
  hysteria: 'Hysteria 2',
  shadowsocks: 'Shadowsocks 2022',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  mtproto: 'MTProto',
  socks5: 'SOCKS5',
  http: 'HTTP',
  telegramweb: 'WEB',
  mieru: 'Mieru',
  'xray#singbox': 'Xray protocols',
  'hysteria#singbox': 'Hysteria 2',
  'shadowsocks#singbox': 'Shadowsocks 2022',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  shadowtls: 'ShadowTLS',
};

/** Each protocol keeps one accent across every screen it appears on. */
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

/** Third line of a protocol tile: the caveat, not the pitch. */
export const PROTOCOL_TILE_NOTE: Record<string, string> = {
  xray: 'REALITY probe-resist tuning',
  hysteria: 'own process, own port',
  shadowsocks: 'multi-user, per-user keys',
  amneziawg: 'kernel module, no userspace proc',
  naive: 'Caddy fork, no per-user stats',
  // The artboard prints the daemon's version here. The panel is not told it:
  // only the xray core reports a version, so the line names the binary and
  // stops there rather than showing a number nobody measured.
  mtproto: 'mtg daemon, no per-user stats',
  socks5: 'on the xray core',
  http: 'on the xray core',
  telegramweb: 'proof-of-concept',
  mieru: 'no handshake to fingerprint',
  'xray#singbox': 'no REALITY probe-resist tuning',
  'hysteria#singbox': 'stats via sing-box API',
  'shadowsocks#singbox': 'multi-user, per-user keys',
  tuic: 'sing-box only',
  anytls: 'sing-box only',
  shadowtls: 'sing-box only',
};

/**
 * Tiles whose third line is a warning rather than a caption, and so carries
 * the amber instead of the muted grey. Only the Telegram WEB view earns it:
 * upstream ships it as a proof-of-concept, which is a fact about the thing,
 * not a detail about our build of it.
 */
export const PROTOCOL_TILE_NOTE_WARN = new Set(['telegramweb']);
