import { describe, expect, it } from 'vitest';
import { PROFILE_CONFIG_KEYS, PROTOCOL_NAMES } from '@iceslab/shared';
import { profileFacts } from '@/contours/profiles/lib/profileFacts';
import { SEEDED } from '@/contours/profiles/lib/seededConfigs';

describe('profileFacts: the card reads keys the config holds (A-287)', () => {
  for (const protocol of PROTOCOL_NAMES) {
    it(`${protocol}: a fully seeded profile has no «-», every key read is in the shared list`, () => {
      for (const config of SEEDED[protocol]) {
        const facts = profileFacts(protocol, config, false);
        expect(facts.length).toBeGreaterThan(0);
        for (const f of facts) {
          expect(f.value, `${protocol}.${f.label}`).not.toBe('-');
          for (const k of f.keys) expect(PROFILE_CONFIG_KEYS[protocol].form, `${protocol}.${f.label}`).toContain(k);
        }
      }
    });
  }

  it('values: nested AWG keys, xray sni by security, hysteria password never shown', () => {
    const awg = profileFacts('amneziawg', SEEDED.amneziawg[0], false);
    expect(awg.map((f) => [f.label, f.value])).toEqual([
      ['subnet', '10.77.0.0/24'],
      ['jc', '5'],
      ['s1', '20'],
    ]);
    const [reality, tls] = SEEDED.xray.map((c) => profileFacts('xray', c, false));
    expect(reality!.find((f) => f.label === 'sni')!.value).toBe('www.microsoft.com');
    expect(tls!.find((f) => f.label === 'sni')!.value).toBe('tls.example.com');
    const hy = profileFacts('hysteria', SEEDED.hysteria[0], false);
    expect(hy.map((f) => f.value)).toEqual(['salamander', 'www.bing.com', '20000-50000']);
    expect(JSON.stringify(hy)).not.toContain('obfs-secret');
  });

  it('SOCKS5 and HTTP: what they speak, from listed keys', () => {
    const facts = profileFacts('xray', { subprotocol: 'socks', security: 'none', network: 'raw' }, true);
    expect(facts.map((f) => f.value)).toEqual(['socks', 'none', 'raw']);
    for (const f of facts) for (const k of f.keys) expect(PROFILE_CONFIG_KEYS.xray.form).toContain(k);
  });

  it('a key not set is «-», a broken config is read as empty', () => {
    expect(profileFacts('mieru', {}, false)).toEqual([{ label: 'mtu', value: '-', keys: ['mtu'] }]);
    for (const c of [null, undefined, 'x', 7]) {
      expect(profileFacts('amneziawg', c, false).every((f) => f.value === '-')).toBe(true);
    }
    expect(profileFacts('amneziawg', { obfuscation: 'x' }, false)[1]!.value).toBe('-');
  });
});
