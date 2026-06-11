import { describe, expect, it } from 'vitest';
import { resolveSquadRouting } from './subscription.service.js';

// R3-a - the per-squad routing merge rule (the one design decision in R3-a).
describe('resolveSquadRouting', () => {
  it('inherits (null) when no squad overrides', () => {
    expect(resolveSquadRouting([null, null])).toBe(null);
    expect(resolveSquadRouting([])).toBe(null);
  });

  it('uses the single override', () => {
    expect(resolveSquadRouting([null, 'ru-split'])).toBe('ru-split');
    expect(resolveSquadRouting(['proxy-all'])).toBe('proxy-all');
  });

  it('dedupes identical overrides', () => {
    expect(resolveSquadRouting(['ru-split', 'ru-split', null])).toBe('ru-split');
  });

  it('falls back to null on conflicting overrides', () => {
    expect(resolveSquadRouting(['ru-split', 'proxy-all'])).toBe(null);
  });

  it('ignores invalid/garbage preset values', () => {
    expect(resolveSquadRouting(['garbage', 'ru-split'])).toBe('ru-split');
    expect(resolveSquadRouting(['garbage', 'also-bad'])).toBe(null);
  });
});
