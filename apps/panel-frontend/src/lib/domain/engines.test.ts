import { describe, expect, it } from 'vitest';
import { engineVersionWords, profilePairLabel } from '@/lib/domain/engines';
import type { Node } from '@/lib/domain/nodes';

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

describe('engineVersionWords', () => {
  type N = Pick<Node, 'engines' | 'cores' | 'coreVersion'>;
  const node = (n: Partial<N>): N => ({ engines: undefined, cores: undefined, coreVersion: null, ...n }) as N;

  it('each engine with its own version; xray\'s never lands on sing-box', () => {
    expect(
      engineVersionWords(
        node({
          engines: ['xray', 'singbox'],
          coreVersion: '26.3.27',
          cores: {
            observedAt: '2026-09-23T00:00:00Z',
            cores: [
              { name: 'xray', engine: 'xray', version: '26.3.27' },
              { name: 'hysteria', engine: 'singbox', version: '1.13.14' },
            ],
          } as N['cores'],
        }),
        t,
      ),
    ).toBe('engine.xray 26.3.27, engine.singbox 1.13.14');
  });

  it('sing-box without a version stays bare; xray falls back to coreVersion only for itself', () => {
    expect(
      engineVersionWords(
        node({
          engines: ['xray', 'singbox'],
          coreVersion: '26.3.27',
          cores: { observedAt: '', cores: [{ name: 'hysteria', engine: 'singbox', version: '' }] } as N['cores'],
        }),
        t,
      ),
    ).toBe('engine.xray 26.3.27, engine.singbox');
  });

  it('a missing binary lends no version', () => {
    expect(
      engineVersionWords(
        node({
          engines: ['singbox'],
          cores: {
            observedAt: '',
            cores: [{ name: 'tuic', engine: 'singbox', version: '1.13.14', installed: false }],
          } as N['cores'],
        }),
        t,
      ),
    ).toBe('engine.singbox');
  });
});
