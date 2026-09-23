import { describe, expect, it } from 'vitest';
import { dialTabOf, dialTabs } from '@/contours/users/lib/dialTabs';

describe('dialTabOf', () => {
  it('socks and http on xray get tabs of their own, named as on the Telegram shelf', () => {
    expect(dialTabOf({ protocol: 'xray', subprotocol: 'socks' })).toEqual({ key: 'xray:socks', label: 'SOCKS5' });
    expect(dialTabOf({ protocol: 'xray', subprotocol: 'http' })).toEqual({ key: 'xray:http', label: 'HTTP' });
  });

  it('vless, vmess, trojan and a missing key stay under the xray tab', () => {
    const xray = dialTabOf({ protocol: 'xray' });
    expect(xray.key).toBe('xray');
    for (const sub of ['vless', 'vmess', 'trojan']) {
      expect(dialTabOf({ protocol: 'xray', subprotocol: sub })).toEqual(xray);
    }
  });

  it('a socks key on another protocol does not split it', () => {
    expect(dialTabOf({ protocol: 'hysteria', subprotocol: 'socks' }).key).toBe('hysteria');
  });
});

describe('dialTabs', () => {
  it('one tab per kind, in the order the first line of it arrives', () => {
    const tabs = dialTabs([
      { protocol: 'xray', subprotocol: 'vless' },
      { protocol: 'xray', subprotocol: 'socks' },
      { protocol: 'amneziawg' },
      { protocol: 'xray', subprotocol: 'http' },
      { protocol: 'xray', subprotocol: 'socks' },
      { protocol: 'xray', subprotocol: 'trojan' },
    ]);
    expect(tabs.map((t) => t.key)).toEqual(['xray', 'xray:socks', 'amneziawg', 'xray:http']);
  });

  it('an old server (no subprotocol anywhere) keeps today\'s one XRAY tab', () => {
    expect(dialTabs([{ protocol: 'xray' }, { protocol: 'xray' }]).map((t) => t.key)).toEqual(['xray']);
  });
});
