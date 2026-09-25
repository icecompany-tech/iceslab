import { describe, expect, it } from 'vitest';
import type { NodeCore } from '@/lib/domain/nodes';
import {
  canRotateHysteriaTls,
  hostOfAddress,
  hysteriaTlsFacts,
  hysteriaTlsRefusal,
  shortFingerprint,
} from '@/contours/nodes/lib/hysteriaTls';

const SHA = 'ab'.repeat(32);
const OLD = 'cd'.repeat(32);
const hy = (tls?: NodeCore['tls']) => ({ name: 'hysteria', engine: 'hysteria', tls }) as NodeCore;
const minted = { certSha256: SHA, host: '1.2.3.4', createdAt: '2026-09-25T07:00:00Z' };

describe('hysteriaTlsFacts: какой сертификат отдаёт нода (E30a)', () => {
  it('ACME: адрес ноды, без отпечатка', () => {
    expect(hysteriaTlsFacts({ hysteriaTls: null, address: 'hy.example.com:1337' }, hy({ source: 'acme' }))).toEqual({
      kind: 'acme',
      host: 'hy.example.com',
    });
  });

  it('самоподписанный: совпадает с панелью; не совпадает (ждёт пуша); срок', () => {
    expect(
      hysteriaTlsFacts(
        { hysteriaTls: minted, address: '1.2.3.4:1337' },
        hy({ source: 'self-signed', certSha256: SHA, notAfter: '2036-09-25T07:00:00Z' }),
      ),
    ).toEqual({ kind: 'self-signed', fingerprint: 'ab:ab:ab:ab:ab:ab:ab:ab', match: true, notAfter: '2036-09-25T07:00:00Z' });
    expect(
      hysteriaTlsFacts({ hysteriaTls: minted, address: '1.2.3.4:1337' }, hy({ source: 'self-signed', certSha256: OLD })),
    ).toMatchObject({ match: false, fingerprint: 'cd:cd:cd:cd:cd:cd:cd:cd' });
    // Сравнивать не с чем: сервер старше поля или агент не прислал отпечаток.
    expect(hysteriaTlsFacts({ address: '1.2.3.4:1337' }, hy({ source: 'self-signed', certSha256: SHA }))).toMatchObject({
      match: null,
    });
    expect(hysteriaTlsFacts({ hysteriaTls: minted, address: '1.2.3.4:1337' }, hy({ source: 'self-signed' }))).toMatchObject({
      match: null,
      fingerprint: null,
    });
  });

  it('агент не сообщил сертификат, а панель пару выпустила: так и сказано', () => {
    expect(hysteriaTlsFacts({ hysteriaTls: minted, address: '1.2.3.4:1337' }, hy(undefined))).toEqual({
      kind: 'unreported',
    });
  });

  it('ни намерения, ни факта: тишина; не нативная hysteria: тишина', () => {
    expect(hysteriaTlsFacts({ hysteriaTls: null, address: 'hy.example.com:1337' }, hy(undefined))).toBeNull();
    expect(hysteriaTlsFacts({ address: 'x:1' }, hy(undefined))).toBeNull();
    const sb = { name: 'hysteria', engine: 'singbox', tls: { source: 'self-signed', certSha256: SHA } } as NodeCore;
    expect(hysteriaTlsFacts({ hysteriaTls: minted, address: '1.2.3.4:1' }, sb)).toBeNull();
  });
});

describe('ротация', () => {
  it('кнопка только при выпущенной панелью паре', () => {
    expect(canRotateHysteriaTls({ hysteriaTls: minted })).toBe(true);
    expect(canRotateHysteriaTls({ hysteriaTls: null })).toBe(false);
    expect(canRotateHysteriaTls({})).toBe(false);
  });

  it('409 HYSTERIA_TLS_NOT_SELF_SIGNED словами сервера; прочее не этот отказ', () => {
    const res = (data: unknown, status: number) => ({ response: { status, data } });
    expect(
      hysteriaTlsRefusal(res({ error: 'HYSTERIA_TLS_NOT_SELF_SIGNED', nodeName: 'hy-1', message: 'hy-1 has a domain' }, 409)),
    ).toEqual({ nodeName: 'hy-1', message: 'hy-1 has a domain' });
    for (const e of [null, 'x', res({ error: 'HYSTERIA_TLS_NOT_SELF_SIGNED' }, 404), res({ error: 'OTHER' }, 409), res(null, 409)])
      expect(hysteriaTlsRefusal(e)).toBeNull();
  });
});

describe('мелочи', () => {
  it('отпечаток: первые 8 байт; кривое значение не отпечаток', () => {
    expect(shortFingerprint(SHA.toUpperCase())).toBe('ab:ab:ab:ab:ab:ab:ab:ab');
    expect(shortFingerprint('abc')).toBeNull();
    expect(shortFingerprint(undefined)).toBeNull();
  });

  it('хост из адреса, IPv6 в скобках', () => {
    expect(hostOfAddress('1.2.3.4:1337')).toBe('1.2.3.4');
    expect(hostOfAddress('[2001:db8::1]:1337')).toBe('2001:db8::1');
    expect(hostOfAddress('hy.example.com')).toBe('hy.example.com');
  });
});
