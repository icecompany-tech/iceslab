import { describe, expect, it } from 'vitest';
import { hasNestedQuantifier } from './srr.schemas.js';

describe('hasNestedQuantifier (ReDoS heuristic)', () => {
  it('flags nested quantifiers as unsafe', () => {
    const dangerous = [
      '(a+)+',
      '(.*)*',
      '(\\w+)+',
      '(a+|b)*',
      '((a+))+',
      '(?:a+)+',
      'x(a*)+y',
      '(a{2,}){3,}',
    ];
    for (const p of dangerous) {
      expect(hasNestedQuantifier(p), p).toBe(true);
    }
  });

  it('allows linear / non-nested patterns', () => {
    const safe = [
      'iPhone',
      '(iPhone|iPad|iPod)',
      '(a|b)*',
      'Mozilla.*Safari',
      '(v2ray)+',
      'abc{2,4}',
      '[a+]+', // + is a literal inside the char class
      '\\(a+\\)+', // escaped parens: no real group
      'Happ/([0-9.]+)',
    ];
    for (const p of safe) {
      expect(hasNestedQuantifier(p), p).toBe(false);
    }
  });
});
