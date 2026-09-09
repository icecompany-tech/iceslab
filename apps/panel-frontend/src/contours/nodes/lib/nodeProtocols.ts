import type { NodeProtocol } from '@/lib/domain/nodes';
// Default mTLS port the node-agent listens on, hard-coded in the installer.
export const DEFAULT_NODE_PORT = 1337;

export const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'anytls', label: 'AnyTLS' },
  { value: 'shadowtls', label: 'ShadowTLS' },
];
export const SINGBOX_NODE_PROTOCOLS: NodeProtocol[] = ['tuic', 'anytls', 'shadowtls'];
export const SINGBOX_ENGINE_CAPABLE: NodeProtocol[] = ['xray', 'hysteria', 'shadowsocks'];
export const NODE_PROTOCOL_GROUPED = [
  ...PROTOCOL_OPTIONS.filter((p) => !SINGBOX_NODE_PROTOCOLS.includes(p.value)),
  {
    group: 'sing-box',
    items: PROTOCOL_OPTIONS.filter((p) => SINGBOX_NODE_PROTOCOLS.includes(p.value)),
  },
];
