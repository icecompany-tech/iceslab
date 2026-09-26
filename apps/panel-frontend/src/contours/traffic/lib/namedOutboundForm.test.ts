import { describe, expect, it } from 'vitest';
import type { NamedOutbound } from '@/lib/domain/namedOutbounds';
import { namedOutboundRefusal } from '@/lib/domain/namedOutbounds';
import {
  outboundConfig,
  outboundCreateBody,
  outboundFormValues,
  outboundProblems,
  outboundUpdateBody,
} from '@/contours/traffic/lib/namedOutboundForm';

const KEY = 'Z84J2IelR9ch3k8VtlVhhs5ycBUlXA7wHBWcBrjqnAw';
const UUID = '0f0c5a7e-2a31-4e6b-9f0a-3c1d2e4f5a6b';

const stored = (over: Partial<NamedOutbound> = {}): NamedOutbound => ({
  id: 'o1',
  name: 'de-exit',
  type: 'vless',
  countryCode: 'DE',
  config: {
    server: 'de.example.com',
    port: 443,
    uuid: UUID,
    flow: 'xtls-rprx-vision',
    security: 'reality',
    sni: 'www.example.com',
    fingerprint: 'chrome',
    realityPublicKey: KEY,
    realityShortId: 'ab12',
  },
  usedBy: [],
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('outboundConfig: ключи по типу и безопасности', () => {
  it('vless reality: всё reality, shortId даже пустой', () => {
    const v = { ...outboundFormValues(stored()), realityShortId: '' };
    expect(outboundConfig(v)).toEqual({
      server: 'de.example.com',
      port: 443,
      uuid: UUID,
      flow: 'xtls-rprx-vision',
      security: 'reality',
      sni: 'www.example.com',
      fingerprint: 'chrome',
      realityPublicKey: KEY,
      realityShortId: '',
    });
  });

  it('vless none: ни flow, ни sni, ни fingerprint, ни alpn, ни reality', () => {
    const v = { ...outboundFormValues(stored()), security: 'none' as const, alpn: 'h2' };
    expect(outboundConfig(v)).toEqual({ server: 'de.example.com', port: 443, uuid: UUID, flow: null, security: 'none' });
  });

  it('vless tls: alpn списком, reality нет', () => {
    const v = { ...outboundFormValues(stored()), security: 'tls' as const, alpn: 'h2, http/1.1' };
    const c = outboundConfig(v);
    expect(c.alpn).toEqual(['h2', 'http/1.1']);
    expect('realityPublicKey' in c || 'realityShortId' in c).toBe(false);
  });

  it('socks: логин и пароль парой или никак; freedom и blackhole пустые', () => {
    const base = { ...outboundFormValues(null), type: 'socks' as const, server: '1.2.3.4', port: 1080 as const };
    expect(outboundConfig(base)).toEqual({ server: '1.2.3.4', port: 1080 });
    expect(outboundConfig({ ...base, username: 'u', password: 'p' })).toEqual({
      server: '1.2.3.4',
      port: 1080,
      username: 'u',
      password: 'p',
    });
    expect(outboundConfig({ ...base, type: 'freedom' })).toEqual({});
  });
});

describe('тела запросов', () => {
  it('POST: страна только заданная', () => {
    const v = { ...outboundFormValues(stored()), countryCode: '' };
    expect('countryCode' in outboundCreateBody(v)).toBe(false);
    expect(outboundCreateBody(outboundFormValues(stored())).countryCode).toBe('DE');
  });

  it('PUT: ничего не правили, пустое тело', () => {
    expect(outboundUpdateBody(stored(), outboundFormValues(stored()))).toEqual({});
  });

  it('PUT: только имя; снятая страна уходит null', () => {
    const v = { ...outboundFormValues(stored()), name: 'de-exit-2', countryCode: '' };
    expect(outboundUpdateBody(stored(), v)).toEqual({ name: 'de-exit-2', countryCode: null });
  });

  it('PUT: правка конфига уходит целым конфигом; смена типа всегда с конфигом', () => {
    const v = { ...outboundFormValues(stored()), port: 8443 as const };
    expect(outboundUpdateBody(stored(), v).config).toMatchObject({ port: 8443 });
    const s = { ...outboundFormValues(stored()), type: 'socks' as const };
    expect(outboundUpdateBody(stored(), s)).toEqual({ type: 'socks', config: { server: 'de.example.com', port: 443 } });
  });
});

describe('outboundProblems: до кнопки', () => {
  it('целый vless reality: чисто', () => {
    expect(outboundProblems(outboundFormValues(stored()))).toEqual({});
  });

  it('имя, ключ, shortId нечётный, sni у reality, uuid', () => {
    const v = {
      ...outboundFormValues(stored()),
      name: 'De Exit',
      realityPublicKey: 'short',
      realityShortId: 'abc',
      sni: '',
      uuid: 'nope',
    };
    expect(outboundProblems(v)).toEqual({
      name: 'name',
      realityPublicKey: 'realityPublicKey',
      realityShortId: 'realityShortId',
      sni: 'sni',
      uuid: 'uuid',
    });
  });

  it('порт и сервер; socks без пары', () => {
    const v = { ...outboundFormValues(null), name: 'x', type: 'socks' as const, server: '', port: 70000, username: 'u' };
    expect(outboundProblems(v)).toEqual({ server: 'server', port: 'port', password: 'socksPair' });
  });
});

describe('namedOutboundRefusal: отказы по полям', () => {
  const res = (status: number, data: unknown) => ({ response: { status, data } });

  it('400 VALIDATION и VALIDATION_ERROR: поле из пути config', () => {
    expect(
      namedOutboundRefusal(
        res(400, { error: 'VALIDATION', issues: [{ path: ['config', 'realityPublicKey'], message: 'm' }, { path: ['name'], message: 'n' }] }),
      ),
    ).toEqual({ code: 'VALIDATION', issues: [{ field: 'realityPublicKey', message: 'm' }, { field: 'name', message: 'n' }] });
    expect(namedOutboundRefusal(res(400, { error: 'VALIDATION_ERROR', issues: [{ path: ['config', 'sni'], message: 's' }] })))
      .toEqual({ code: 'VALIDATION', issues: [{ field: 'sni', message: 's' }] });
  });

  it('409: имя занято, используется, тип не для направления', () => {
    const used = [{ cascadeId: 'c1', cascadeName: 'ru-de', directionTag: 2 }];
    expect(namedOutboundRefusal(res(409, { error: 'NAMED_OUTBOUND_NAME_TAKEN', name: 'de-exit' }))).toEqual({
      code: 'NAME_TAKEN',
      name: 'de-exit',
    });
    expect(namedOutboundRefusal(res(409, { error: 'NAMED_OUTBOUND_IN_USE', usedBy: [...used, { junk: 1 }] }))).toEqual({
      code: 'IN_USE',
      usedBy: used,
    });
    expect(
      namedOutboundRefusal(res(409, { error: 'NAMED_OUTBOUND_TYPE_NOT_FOR_DIRECTION', type: 'freedom', usedBy: used })),
    ).toEqual({ code: 'TYPE_NOT_FOR_DIRECTION', type: 'freedom', usedBy: used });
  });

  it('мусор и чужие ответы: null', () => {
    for (const e of [null, 'x', new Error('x'), res(409, { error: 'OTHER' }), res(400, { error: 'VALIDATION' }), res(500, null)]) {
      expect(namedOutboundRefusal(e)).toBeNull();
    }
  });
});
