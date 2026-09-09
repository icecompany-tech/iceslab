/**
 * Shared human-readable labels for the seven supported protocol enums.
 *
 * Without this, Mantine Selects and dividers were rendering the raw enum
 * values ("hysteria", "amneziawg", "mtproto") in lowercase, visible in
 * the Profile form Divider and the Squad form per-protocol group title.
 * Labels are product/protocol names, kept in English on purpose:
 * operators read xray / hysteria / AWG docs in English, translating
 * those identifiers makes panel UI diverge from upstream documentation.
 */
export interface ProtocolOption {
  value: string;
  label: string;
}

// Display order is intentional (xray first as the flagship). When sing-box
// lands as an engine it goes right after xray:
//   xray, sing-box, hysteria, amneziawg, naive, shadowsocks, mtproto, mieru
export const PROTOCOL_OPTIONS: ProtocolOption[] = [
  { value: 'xray', label: 'Xray' },
  { value: 'tuic', label: 'TUIC (sing-box)' },
  { value: 'anytls', label: 'AnyTLS (sing-box)' },
  { value: 'shadowtls', label: 'ShadowTLS (sing-box)' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only, mtg)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
];

/** Compact label, suitable for badges / dividers that can't fit the
 *  parenthetical suffix. Falls back to the verbose label if no compact
 *  form exists. */
const COMPACT: Record<string, string> = {
  hysteria: 'Hysteria 2',
  xray: 'Xray',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  shadowtls: 'ShadowTLS',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  shadowsocks: 'Shadowsocks',
  mtproto: 'MTProto',
  mieru: 'Mieru',
};

export function protocolLabel(value: string): string {
  return PROTOCOL_OPTIONS.find((p) => p.value === value)?.label ?? value;
}

export function protocolLabelCompact(value: string): string {
  return COMPACT[value] ?? value;
}

/**
 * Oldest xray-core that understands vlessRoute, i.e. the per-exit UUID a
 * balancer entry authenticates on. Below this the entry rejects the client at
 * auth and the connection just fails, so the panel warns before the save and
 * blocks enabling such a cascade server-side (MIN_XRAY_VLESSROUTE there).
 */
export const MIN_CASCADE_CORE = '25.9.5';

/** Dotted-version compare. A missing version is not "older": a node that has
 *  not reported one yet is unknown, and guessing would cry wolf. */
export function isOlderThan(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const parse = (v: string) => v.replace(/^v/i, '').split(/[-+]/)[0]!.split('.').map(Number);
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x)) return false;
    if (x !== y) return x < y;
  }
  return false;
}
