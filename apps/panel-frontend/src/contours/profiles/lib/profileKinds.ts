import type { ProtocolName } from '@/lib/domain/protocols';

// Profile protocol dropdown. The sing-box engine is folded INTO this list
// instead of a separate control: a protocol that runs on either core (xray /
// hysteria / shadowsocks) appears once as a native entry and once in the
// "sing-box" group, and the sing-box-only protocols (TUIC / AnyTLS / ShadowTLS)
// live in that group too. Picking an item sets both the protocol and the engine.

// Protocols that can run on the sing-box engine besides their native core.
// Mirrors the backend's ENGINE_OPTIONS; also gates the engine field in buildConfig.
export const ENGINE_CHOICE_PROTOCOLS = ['xray', 'hysteria', 'shadowsocks'];

export interface ProfileKind {
  key: string;
  protocol: ProtocolName;
  engine: 'native' | 'singbox';
  label: string;
}

// One kind per selectable (protocol, engine). A shared protocol has two (native
// + sing-box); native-only and sing-box-only protocols have one. The sing-box
// variant of a shared protocol is keyed `<protocol>#singbox` to stay distinct.
export const PROFILE_KINDS: ProfileKind[] = [
  { key: 'xray', protocol: 'xray', engine: 'native', label: 'Xray (native)' },
  { key: 'hysteria', protocol: 'hysteria', engine: 'native', label: 'Hysteria 2 (native)' },
  { key: 'shadowsocks', protocol: 'shadowsocks', engine: 'native', label: 'Shadowsocks 2022 (native)' },
  { key: 'amneziawg', protocol: 'amneziawg', engine: 'native', label: 'AmneziaWG' },
  { key: 'naive', protocol: 'naive', engine: 'native', label: 'NaiveProxy' },
  { key: 'mtproto', protocol: 'mtproto', engine: 'native', label: 'MTProto (Telegram-only, mtg)' },
  { key: 'mieru', protocol: 'mieru', engine: 'native', label: 'Mieru (stealth proxy)' },
  { key: 'xray#singbox', protocol: 'xray', engine: 'singbox', label: 'Xray (VLESS/VMess/Trojan)' },
  { key: 'hysteria#singbox', protocol: 'hysteria', engine: 'singbox', label: 'Hysteria 2' },
  { key: 'shadowsocks#singbox', protocol: 'shadowsocks', engine: 'singbox', label: 'Shadowsocks 2022' },
  { key: 'tuic', protocol: 'tuic', engine: 'singbox', label: 'TUIC' },
  { key: 'anytls', protocol: 'anytls', engine: 'singbox', label: 'AnyTLS' },
  { key: 'shadowtls', protocol: 'shadowtls', engine: 'singbox', label: 'ShadowTLS' },
];

export const PROFILE_KIND_BY_KEY = new Map(PROFILE_KINDS.map((k) => [k.key, k] as const));

// The Select key for a (protocol, engine) pair. Only a shared protocol on
// sing-box gets the suffix; sing-box-only protocols key by their own name.
export function profileKindKey(protocol: string, engine: 'native' | 'singbox'): string {
  return engine === 'singbox' && ENGINE_CHOICE_PROTOCOLS.includes(protocol)
    ? `${protocol}#singbox`
    : protocol;
}

// Grouped Select data (create mode): native cores first, then a sing-box group.
export const PROFILE_PROTOCOL_GROUPED = [
  ...PROFILE_KINDS.filter((k) => k.engine === 'native').map((k) => ({ value: k.key, label: k.label })),
  {
    group: 'sing-box',
    items: PROFILE_KINDS.filter((k) => k.engine === 'singbox').map((k) => ({
      value: k.key,
      label: k.label,
    })),
  },
];
