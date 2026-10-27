import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { refreshAfterNodePolicyChange } from '@/contours/traffic/lib/nodePolicyRefresh';

describe('refreshAfterNodePolicyChange: правка и удаление политики ноды (A-283)', () => {
  it('сбрасывает страницу ноды и рисунок политики по префиксу, а не только списки', () => {
    const qc = new QueryClient();
    const keys = [
      ['node-policies'],
      ['nodes', 'all'],
      ['node', 'n1'],
      ['node', 'n2'],
      ['policy-drawing', 'n1'],
      ['cascades'],
    ];
    for (const k of keys) qc.setQueryData(k, { any: true });
    refreshAfterNodePolicyChange(qc);
    const stale = (k: string[]) => qc.getQueryState(k)?.isInvalidated;
    expect(stale(['node-policies'])).toBe(true);
    expect(stale(['nodes', 'all'])).toBe(true);
    expect(stale(['node', 'n1'])).toBe(true);
    expect(stale(['node', 'n2'])).toBe(true);
    expect(stale(['policy-drawing', 'n1'])).toBe(true);
    // Not a node policy's business.
    expect(stale(['cascades'])).toBe(false);
  });
});
