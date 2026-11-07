import type { QueryClient } from '@tanstack/react-query';

/**
 * What a saved or deleted node policy makes stale, by prefix (A-283): the list, the fleet
 * (squads read `policyId` off it), each node page, each node's drawing of its policy.
 */
export const NODE_POLICY_STALE_KEYS: readonly (readonly string[])[] = [['node-policies'], ['nodes'], ['fleet'], ['node'], ['policy-drawing']];

export function refreshAfterNodePolicyChange(qc: QueryClient): void {
  for (const queryKey of NODE_POLICY_STALE_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
}
