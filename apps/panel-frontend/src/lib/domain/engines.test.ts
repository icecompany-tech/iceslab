import { describe, expect, it } from 'vitest';
import { profilePairLabel } from '@/lib/domain/engines';

// The key and its arguments are what the screen receives; the wording is i18n's.
const t = (key: string, opts?: Record<string, unknown>) =>
  key === 'engine.pair' ? `${String(opts?.protocol)} · ${String(opts?.engine)}` : key;

describe('profilePairLabel', () => {
  it('1. vless on xray: the protocol names it', () => {
    expect(profilePairLabel({ protocol: 'xray', effectiveEngine: 'xray', config: { subprotocol: 'vless' } }, t)).toBe(
      'Xray · engine.xray',
    );
  });

  it('2. socks on xray: SOCKS5, even with the vless defaults the server writes beside it', () => {
    expect(
      profilePairLabel(
        { protocol: 'xray', effectiveEngine: 'xray', config: { subprotocol: 'socks', flow: 'xtls-rprx-vision' } },
        t,
      ),
    ).toBe('SOCKS5 · engine.xray');
  });

  it('3. http on xray: HTTP', () => {
    expect(profilePairLabel({ protocol: 'xray', effectiveEngine: 'xray', config: { subprotocol: 'http' } }, t)).toBe(
      'HTTP · engine.xray',
    );
  });

  it('4. no config at all: the protocol answers, as before', () => {
    expect(profilePairLabel({ protocol: 'xray', effectiveEngine: 'xray' }, t)).toBe('Xray · engine.xray');
  });
});
