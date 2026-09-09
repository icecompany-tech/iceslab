export type EngineTab = 'native' | 'xray' | 'singbox';

export function engineTabOf(protocol: string, engine: 'native' | 'singbox'): EngineTab {
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
  mtproto: 'Telegram only, no per-user stats',
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
  mtproto: 'Telegram only, no per-user stats',
  mieru: 'no handshake to fingerprint',
  'xray#singbox': 'no REALITY probe-resist tuning',
  'hysteria#singbox': 'stats via sing-box API',
  'shadowsocks#singbox': 'multi-user, per-user keys',
  tuic: 'sing-box only',
  anytls: 'sing-box only',
  shadowtls: 'sing-box only',
};
