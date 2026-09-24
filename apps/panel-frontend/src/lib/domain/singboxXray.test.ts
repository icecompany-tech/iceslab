import { describe, expect, it } from 'vitest';
import { singboxXrayMessage, singboxXrayRefusal } from '@/lib/domain/singboxXray';

// The server's own sentence (profiles.schemas.ts SINGBOX_XRAY_FAMILY_MESSAGE).
const MSG =
  'sing-box serves the xray family only as REALITY over raw; use the xray engine for TLS, none, self-steal and other transports';
const res = (data: unknown, status = 400) => ({ response: { status, data } });

describe('singboxXrayRefusal', () => {
  it('создание: каждое из трёх полей по issues[].path', () => {
    for (const field of ['security', 'realityMode', 'network']) {
      const err = res({ error: 'VALIDATION_ERROR', message: 'Invalid input', issues: [{ code: 'custom', message: MSG, path: ['config', field] }] });
      expect(singboxXrayRefusal(err)).toEqual({ where: 'config', field });
    }
  });

  it('правка: { error: INVALID, path }', () => {
    expect(singboxXrayRefusal(res({ error: 'INVALID', message: MSG, path: ['config', 'network'] }))).toEqual({
      where: 'config',
      field: 'network',
    });
  });

  it('привязка: path overrides', () => {
    expect(singboxXrayRefusal(res({ error: 'INVALID', message: MSG, path: ['overrides', 'network'] }))).toEqual({
      where: 'overrides',
      field: 'network',
    });
  });

  it('отказ socks/http на том же пути config.security это не он', () => {
    const socks = res({
      error: 'VALIDATION_ERROR',
      issues: [{ code: 'custom', message: 'subprotocol socks takes security "none" only (got "reality")', path: ['config', 'security'] }],
    });
    expect(singboxXrayRefusal(socks)).toBeNull();
  });

  it('мусор и чужие ответы: null', () => {
    for (const e of [
      null,
      undefined,
      'boom',
      new Error('x'),
      res({ error: 'INVALID', message: MSG, path: ['engine'] }),
      res({ error: 'INVALID', message: MSG, path: ['config', 'flow'] }),
      res({ error: 'INVALID', message: MSG, path: ['config', 'network'] }, 409),
      res({ issues: 'nope' }),
      res(null),
    ]) {
      expect(singboxXrayRefusal(e)).toBeNull();
    }
  });
});

describe('singboxXrayMessage', () => {
  const t = (key: string, opts?: Record<string, string>) => (opts ? `${key}(${opts.field})` : key);

  it('поле профиля и поле привязки говорят разными фразами, поле по имени', () => {
    expect(singboxXrayMessage({ where: 'config', field: 'network' }, t)).toBe(
      'profileEdit.singboxXrayRefused(profileEdit.singboxXrayField.network)',
    );
    expect(singboxXrayMessage({ where: 'overrides', field: 'realityMode' }, t)).toBe(
      'profileEdit.singboxXrayRefusedBinding(profileEdit.singboxXrayField.realityMode)',
    );
  });
});
