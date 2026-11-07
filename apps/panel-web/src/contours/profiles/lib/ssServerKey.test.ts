import { describe, expect, it } from 'vitest';
import { ssConfigPatch, ssKeyState, storedSsKey } from '@/contours/profiles/lib/ssServerKey';

const KEY32 = btoa('b'.repeat(32));
const stored = { method: '2022-blake3-aes-256-gcm', serverPsk: KEY32 };

describe('storedSsKey', () => {
  it('checks its input first', () => {
    expect(storedSsKey(null)).toBeNull();
    expect(storedSsKey('x')).toBeNull();
    expect(storedSsKey({ serverPsk: 5 })).toBeNull();
    expect(storedSsKey({ serverPsk: '' })).toBeNull();
    expect(storedSsKey({ serverPsk: KEY32 })).toBe(KEY32);
  });
});

describe('ssConfigPatch: the form never sends a key, the server keeps or issues it (2a09844)', () => {
  it('an edit that keeps the cipher sends no config', () => {
    expect(ssConfigPatch(stored, true, '2022-blake3-aes-256-gcm')).toEqual({});
  });

  it('a changed cipher sends the cipher alone, whatever the key length', () => {
    expect(ssConfigPatch(stored, true, '2022-blake3-aes-128-gcm')).toEqual({ config: { method: '2022-blake3-aes-128-gcm' } });
    expect(ssConfigPatch(stored, true, '2022-blake3-chacha20-poly1305')).toEqual({
      config: { method: '2022-blake3-chacha20-poly1305' },
    });
  });

  it('a profile the old save left keyless sends the cipher, and the server issues the key', () => {
    expect(ssConfigPatch({ method: '2022-blake3-aes-256-gcm' }, true, '2022-blake3-aes-256-gcm')).toEqual({
      config: { method: '2022-blake3-aes-256-gcm' },
    });
  });

  it('a create sends the cipher alone', () => {
    expect(ssConfigPatch(null, false, '2022-blake3-aes-256-gcm')).toEqual({ config: { method: '2022-blake3-aes-256-gcm' } });
  });
});

describe('ssKeyState', () => {
  it('says set, change, new or server, in step with what the save sends', () => {
    expect(ssKeyState(stored, true, '2022-blake3-aes-256-gcm')).toBe('set');
    expect(ssKeyState(stored, true, '2022-blake3-aes-128-gcm')).toBe('change');
    expect(ssKeyState({ method: 'x' }, true, '2022-blake3-aes-256-gcm')).toBe('new');
    expect(ssKeyState(null, false, '2022-blake3-aes-256-gcm')).toBe('server');
  });
});
