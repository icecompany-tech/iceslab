import { describe, expect, it } from 'vitest';
import { extTokenKind, geoTagQuery, withGeoTag } from '@/contours/traffic/lib/geoTagHint';
import { parseTokens } from '@/contours/traffic/lib/nodePolicyMatch';
import type { GeoSetKind } from '@/lib/domain/geoSets';

describe('geoTagQuery: последний токен строки', () => {
  it('встроенные geosite: и geoip:, набранная часть тега', () => {
    expect(geoTagQuery('domain:x.ru · geosite:categ')).toEqual({
      setName: 'geosite',
      prefix: 'geosite:',
      q: 'categ',
      start: 14,
    });
    expect(geoTagQuery('geoip:')).toMatchObject({ setName: 'geoip', q: '', start: 0 });
  });

  it('свой набор ext:<name>:, разделители пробел, запятая, точка', () => {
    expect(geoTagQuery('a b,ext:ru-blocked:gov')).toMatchObject({ setName: 'ru-blocked', prefix: 'ext:ru-blocked:', q: 'gov' });
  });

  it('не гео-токен, ext без имени, ext в верхнем регистре: подсказки нет', () => {
    expect(geoTagQuery('domain:x.ru')).toBeNull();
    expect(geoTagQuery('ext:')).toBeNull();
    expect(geoTagQuery('EXT:ru:x')).toBeNull();
    expect(geoTagQuery('')).toBeNull();
  });

  it('выбор тега заменяет только набираемый токен', () => {
    const line = 'domain:x.ru · geosite:categ';
    expect(withGeoTag(line, geoTagQuery(line)!, 'category-ru')).toBe('domain:x.ru · geosite:category-ru');
  });
});

describe('ext-набор по виду при разборе строки правила ноды', () => {
  const kinds = new Map<string, GeoSetKind>([
    ['corp-ip', 'geoip'],
    ['ru-blocked', 'geosite'],
  ]);
  const base = { domain: [], ip: [], network: null, port: null, protocol: [] } as unknown as Parameters<typeof parseTokens>[1];

  it('geoip-набор уходит в адреса, geosite-набор в домены; незнакомый как раньше', () => {
    expect(extTokenKind('ext:corp-ip:office', kinds)).toBe('geoip');
    expect(extTokenKind('ext:nope:x', kinds)).toBeNull();
    const m = parseTokens('ext:corp-ip:office · ext:ru-blocked:gov · ext:nope:x · geoip:ru', base, kinds);
    expect(m.ip).toEqual(['ext:corp-ip:office', 'geoip:ru']);
    expect(m.domain).toEqual(['ext:ru-blocked:gov', 'ext:nope:x']);
  });

  it('без списка наборов разбор прежний', () => {
    expect(parseTokens('ext:corp-ip:office', base).domain).toEqual(['ext:corp-ip:office']);
  });
});
