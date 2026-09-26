import { describe, expect, it } from 'vitest';
import { policyEntryUnknown, unknownInMatch } from '@/lib/domain/routePolicies';

describe('policyEntryUnknown: 400 ROUTE_POLICY_ENTRY_UNKNOWN (265e93e)', () => {
  const res = (status: number, data: unknown) => ({ response: { status, data } });

  it('записи из ответа, нестроковые пропускаются', () => {
    expect(
      policyEntryUnknown(res(400, { error: 'ROUTE_POLICY_ENTRY_UNKNOWN', message: 'm', entries: ['foo bar', 'geoipx:ru', 7] })),
    ).toEqual(['foo bar', 'geoipx:ru']);
  });

  it('чужой отказ и мусор: null', () => {
    for (const e of [
      null,
      'x',
      new Error('x'),
      res(409, { error: 'ROUTE_POLICY_ENTRY_UNKNOWN', entries: ['a'] }),
      res(400, { error: 'VALIDATION_ERROR', entries: ['a'] }),
      res(400, { error: 'ROUTE_POLICY_ENTRY_UNKNOWN' }),
      res(400, null),
    ]) {
      expect(policyEntryUnknown(e)).toBeNull();
    }
  });
});

describe('unknownInMatch: какие записи строки отвергнуты', () => {
  it('пересечение в порядке строки', () => {
    expect(unknownInMatch(['geosite:google', 'bad', 'geoip:ru', 'worse'], ['worse', 'bad'])).toEqual(['bad', 'worse']);
    expect(unknownInMatch(['geosite:google'], ['bad'])).toEqual([]);
    expect(unknownInMatch([], [])).toEqual([]);
  });
});
