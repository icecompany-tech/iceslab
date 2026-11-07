import { describe, expect, it } from 'vitest';
import { blankNodePolicy } from '@/lib/old/nodePolicies';
import { nodeCountOf, nodeCountWords } from '@/contours/traffic/lib/nodePolicyCount';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;

describe('число нод на политике ноды (A-251)', () => {
  it('нет поля или не число это «неизвестно», а не 0', () => {
    expect(nodeCountOf({})).toBeNull();
    expect(nodeCountOf({ nodeCount: '3' })).toBeNull();
    expect(nodeCountOf({ nodeCount: -1 })).toBeNull();
    expect(nodeCountOf({ nodeCount: 1.5 })).toBeNull();
    expect(nodeCountOf({ nodeCount: 0 })).toBe(0);
    expect(nodeCountOf({ nodeCount: 4 })).toBe(4);
    // A draft has not been saved anywhere: 0 is the fact there.
    expect(nodeCountOf(blankNodePolicy())).toBe(0);
  });

  it('чип и окно удаления говорят «неизвестно», ноль только при ответе 0', () => {
    expect(nodeCountWords(null, t)).toEqual({ chip: 'routes.nodeOnUnknown', deleteBody: 'routes.nodeDeleteBodyUnknown' });
    expect(nodeCountWords(0, t)).toEqual({ chip: 'routes.nodeOnNoNodes', deleteBody: 'routes.nodeDeleteBody {"count":0}' });
    expect(nodeCountWords(2, t).chip).toBe('routes.nodeOnNodes {"count":2}');
  });
});
