import { describe, expect, it } from 'vitest';
import {
  NEW_POLICY_ID,
  POLICY_ACTIONS,
  findShadows,
  importedPolicy,
  policyDirty,
  toRules,
} from '@/contours/traffic/lib/routeRules';
import type { RoutePolicy } from '@/lib/old/routePolicies';

const policy = (blockDomains: string[], directDomains: string[]): RoutePolicy => ({
  id: 'p1',
  name: 'ads',
  ordinal: 1,
  blockDomains,
  directDomains,
});
const row = (id: string, action: 'block' | 'direct' | 'warp', ...match: string[]) => ({ id, match, action, note: '' });

describe('A-151: редактор политики входа показывает то, что хранит сервер', () => {
  it('два действия, блок и напрямую', () => {
    expect(POLICY_ACTIONS).toEqual(['block', 'direct']);
  });

  it('строки строятся только из двух списков, блок первым; rules сервера не читаются', () => {
    const p = { ...policy(['ads.com'], ['vk.com']), rules: [row('r', 'warp', 'x.com')] };
    expect(toRules(p).map((r) => [r.action, r.match[0]])).toEqual([
      ['block', 'ads.com'],
      ['direct', 'vk.com'],
    ]);
  });

  it('домен и в блоке, и в прямом: перекрыто прямое, даже если прямое стоит выше', () => {
    const shadows = findShadows([row('d', 'direct', 'x.com'), row('b', 'block', 'x.com')]);
    expect(shadows.get('d')).toEqual({ match: 'x.com', by: 'block' });
    expect(shadows.has('b')).toBe(false);
  });

  it('повтор в одном списке: перекрыта поздняя строка', () => {
    const shadows = findShadows([row('a', 'direct', 'x.com'), row('b', 'direct', 'x.com')]);
    expect(shadows.get('b')).toEqual({ match: 'x.com', by: 'direct' });
  });

  it('«не сохранено» сравнивает два множества, а не порядок строк', () => {
    const p = policy(['a.com', 'b.com'], ['c.com']);
    expect(policyDirty(p, 'ads', [row('1', 'block', 'b.com'), row('2', 'direct', 'c.com'), row('3', 'block', 'a.com')])).toBe(false);
    expect(policyDirty(p, 'ads', [row('1', 'block', 'a.com', 'b.com', 'c.com')])).toBe(true);
    expect(policyDirty({ ...p, id: NEW_POLICY_ID }, 'ads', toRules(p))).toBe(true);
  });

  it('после сохранения метка гаснет: сервер вернул то, что ушло', () => {
    const draft = [row('1', 'direct', 'x.com'), row('2', 'block', 'x.com', 'y.com')];
    const saved = policy(['y.com', 'x.com'], ['x.com']);
    expect(policyDirty(saved, 'ads', draft)).toBe(false);
  });

  it('импорт складывается в два списка, WARP и прокси считаются и не берутся', () => {
    const out = importedPolicy([row('1', 'block', 'a.com'), row('2', 'warp', 'w.com'), row('3', 'direct', 'd.com')]);
    expect(out).toEqual({ lists: { blockDomains: ['a.com'], directDomains: ['d.com'] }, dropped: 1 });
  });
});
