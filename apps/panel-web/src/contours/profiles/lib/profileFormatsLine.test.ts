import { describe, expect, it } from 'vitest';
import { profileFormatsLine } from '@/contours/profiles/lib/profileFormatsLine';
import type { ProfileFormats } from '@/lib/old/formats';

const ok = (data: ProfileFormats | null) => ({ data, isError: false });

describe('profileFormatsLine (XraySection на /formats)', () => {
  it('несохранённый профиль: «-», спрашивать нечего', () => {
    expect(profileFormatsLine(null, ok(null))).toEqual({ kind: 'unsaved' });
  });

  it('ожидание, сбой и старый сервер без /formats (null): не «получат все»', () => {
    expect(profileFormatsLine('p', { data: undefined, isError: false })).toEqual({ kind: 'loading' });
    expect(profileFormatsLine('p', { data: undefined, isError: true })).toEqual({ kind: 'unknown' });
    expect(profileFormatsLine('p', ok(null))).toEqual({ kind: 'unknown' });
  });

  it('ответ сервера: не несущие форматы по стороне и причине', () => {
    const data: ProfileFormats = {
      door: 'vless',
      formats: [
        { format: 'singbox', carried: false, why: 'client-lacks-transport', reason: 'transport' },
        { format: 'surge', carried: false, why: 'client-lacks-protocol', reason: 'door' },
        { format: 'clash', carried: true, why: 'native', reason: null },
      ],
    };
    expect(profileFormatsLine('p', ok(data))).toEqual({
      kind: 'gaps',
      groups: [
        { why: 'client-lacks-transport', reason: 'transport', formats: ['singbox'] },
        { why: 'client-lacks-protocol', reason: 'door', formats: ['surge'] },
      ],
    });
  });

  it('всё несётся: строки нет', () => {
    expect(profileFormatsLine('p', ok({ door: 'vless', formats: [{ format: 'clash', carried: true, why: 'native', reason: null }] }))).toEqual({
      kind: 'none',
    });
  });
});
