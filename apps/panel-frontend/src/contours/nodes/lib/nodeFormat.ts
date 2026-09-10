import { AMBER, CYAN, CYAN2, MIST, MOSS, VIOLET } from '@/contours/nodes/lib/colors';
export const PROTOCOL_DOT: Record<string, string> = {
  xray: VIOLET,
  shadowsocks: '#F5A3B8',
  hysteria: CYAN,
  amneziawg: MOSS,
  naive: AMBER,
  mtproto: CYAN2,
  mieru: '#C78BFA',
  tuic: CYAN,
  anytls: MIST,
  shadowtls: MIST,
};

/** The wire shape of a profile, in the shorthand the host rows use. */
export function shapeOf(protocol: string, cfg: Record<string, unknown>): string {
  if (protocol !== 'xray') return protocol;
  const sub = String(cfg['subprotocol'] ?? 'vless');
  const net = String(cfg['network'] ?? 'raw');
  const sec = String(cfg['security'] ?? 'reality');
  return `${sub} ${net === 'raw' ? 'tcp' : net} ${sec}`;
}

export function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${String(h).padStart(2, '0')}h` : `${h}h`;
}
