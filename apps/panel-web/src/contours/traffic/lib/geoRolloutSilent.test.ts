import { describe, expect, it } from 'vitest';
import { rolloutSilent } from '@/contours/traffic/lib/geoRolloutSilent';

describe('rolloutSilent (A-253): рестарт xray «вероятно», а не факт', () => {
  it('список нод не пришёл: каждая нода плана «вероятно», а не «перезапустит»', () => {
    expect([...rolloutSilent(['a', 'b'], undefined)].sort()).toEqual(['a', 'b']);
  });

  it('список пришёл: «вероятно» только у нод без отчёта о ядрах', () => {
    const s = rolloutSilent(['a', 'b'], [{ id: 'a', cores: { cores: [] } }, { id: 'b' }]);
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
  });
});
