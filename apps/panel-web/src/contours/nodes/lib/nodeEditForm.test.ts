import { describe, expect, it } from 'vitest';
import { domainOk, domainPatch, egressOf } from '@/contours/nodes/lib/nodeEditForm';

describe('домен ноды в PUT (A-057)', () => {
  it('уходит только изменённый; пустое снимает домен null', () => {
    expect(domainPatch(null, 'node.example.com')).toEqual({ domain: 'node.example.com' });
    expect(domainPatch(null, '  node.example.com ')).toEqual({ domain: 'node.example.com' });
    expect(domainPatch('node.example.com', 'node.example.com')).toEqual({});
    expect(domainPatch('node.example.com', 'other.example.com')).toEqual({ domain: 'other.example.com' });
    expect(domainPatch('node.example.com', '  ')).toEqual({ domain: null });
    expect(domainPatch(null, '')).toEqual({});
    expect(domainPatch(undefined, '')).toEqual({});
  });

  it('форма проверяет то же, что схема сервера: голое имя хоста до 255', () => {
    expect(domainOk('')).toBe(true);
    expect(domainOk('node-1.example.com')).toBe(true);
    for (const bad of ['https://node.example.com', 'node.example.com:443', 'node example.com', 'нода.рф', 'a'.repeat(256)]) {
      expect(domainOk(bad)).toBe(false);
    }
  });
});

describe('egressOf (spec frontend-nodes п.1)', () => {
  it('нода в каскаде: каскад, что бы ни стояло в WARP', () => {
    expect(egressOf(true, true, true)).toBe('cascade');
    expect(egressOf(true, true, false)).toBe('cascade');
  });

  it('список каскадов не пришёл: неизвестно, а не «напрямую» и не WARP', () => {
    expect(egressOf(false, false, false)).toBe('unknown');
    expect(egressOf(false, false, true)).toBe('unknown');
  });

  it('список пришёл, ноды в нём нет: WARP или напрямую по ноде', () => {
    expect(egressOf(false, true, true)).toBe('warp');
    expect(egressOf(false, true, false)).toBe('direct');
  });
});
