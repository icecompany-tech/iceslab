import { protocolLabel } from '@/lib/domain/protocols';
import { isPlainSubprotocol, PLAIN_LABEL } from '@/lib/domain/xraySubprotocol';

/**
 * Which tab of «what this user can dial» a line belongs to.
 *
 * By protocol, except the two Telegram entries: a SOCKS5 and an HTTP line are
 * xray endpoints on the same node, and under one XRAY tab they read as two
 * identical rows told apart by the port alone. With the server's
 * `subprotocol` they get tabs of their own, named the way the Telegram shelf
 * names them. vless, vmess and trojan stay under XRAY, as before. No key (a
 * server older than it) means no split: everything xray under XRAY.
 */
export interface DialTab {
  key: string;
  label: string;
}

export function dialTabOf(e: { protocol: string; subprotocol?: unknown }): DialTab {
  if (e.protocol === 'xray' && isPlainSubprotocol(e.subprotocol)) {
    return { key: `xray:${e.subprotocol}`, label: PLAIN_LABEL[e.subprotocol] };
  }
  return { key: e.protocol, label: protocolLabel(e.protocol as never) };
}

/** The tabs in the order their first line arrives, each once. */
export function dialTabs(endpoints: Array<{ protocol: string; subprotocol?: unknown }>): DialTab[] {
  const seen = new Map<string, DialTab>();
  for (const e of endpoints) {
    const tab = dialTabOf(e);
    if (!seen.has(tab.key)) seen.set(tab.key, tab);
  }
  return [...seen.values()];
}
