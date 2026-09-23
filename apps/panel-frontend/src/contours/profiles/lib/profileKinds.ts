import type { ProtocolName } from '@/lib/domain/protocols';
import { isPlainSubprotocol, type PlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol';

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
  /** SOCKS5 and HTTP are xray profiles told apart by their subprotocol, not
   *  by a protocol name of their own. Absent on every other kind. */
  subprotocol?: PlainSubprotocol;
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
  // xray only: the server refuses them on sing-box, so there is no
  // `#singbox` twin to pick.
  { key: 'socks5', protocol: 'xray', engine: 'native', subprotocol: 'socks', label: 'SOCKS5 (xray)' },
  { key: 'http', protocol: 'xray', engine: 'native', subprotocol: 'http', label: 'HTTP (xray)' },
  { key: 'mieru', protocol: 'mieru', engine: 'native', label: 'Mieru (stealth proxy)' },
  { key: 'xray#singbox', protocol: 'xray', engine: 'singbox', label: 'Xray (VLESS/VMess/Trojan)' },
  { key: 'hysteria#singbox', protocol: 'hysteria', engine: 'singbox', label: 'Hysteria 2' },
  { key: 'shadowsocks#singbox', protocol: 'shadowsocks', engine: 'singbox', label: 'Shadowsocks 2022' },
  { key: 'tuic', protocol: 'tuic', engine: 'singbox', label: 'TUIC' },
  { key: 'anytls', protocol: 'anytls', engine: 'singbox', label: 'AnyTLS' },
  { key: 'shadowtls', protocol: 'shadowtls', engine: 'singbox', label: 'ShadowTLS' },
];

export const PROFILE_KIND_BY_KEY = new Map(PROFILE_KINDS.map((k) => [k.key, k] as const));

/**
 * The Telegram client offers four ways in. MTProto, SOCKS5 and HTTP are
 * profiles; WEB is drawn here because the operator needs to see the whole
 * shelf to know what is on it, but it is deliberately NOT a ProfileKind: its
 * name is not in the protocol enum, so nothing can post it and get a 400 back.
 * WEB is a three-layer stack (Caddy on 443, the relay, MTProxy) and upstream
 * still calls it a proof-of-concept.
 */
export type PreviewKindKey = 'telegramweb';

export interface PreviewKind {
  key: PreviewKindKey;
  label: string;
}

export const PREVIEW_KINDS: PreviewKind[] = [{ key: 'telegramweb', label: 'WEB' }];

// The Select key for a (protocol, engine) pair. Only a shared protocol on
// sing-box gets the suffix; sing-box-only protocols key by their own name.
// SOCKS5 and HTTP key by their own kind: they share `xray` with vless.
export function profileKindKey(
  protocol: string,
  engine: 'native' | 'singbox',
  subprotocol?: unknown,
): string {
  if (protocol === 'xray' && isPlainSubprotocol(subprotocol)) {
    return PROFILE_KINDS.find((k) => k.subprotocol === subprotocol)?.key ?? protocol;
  }
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
