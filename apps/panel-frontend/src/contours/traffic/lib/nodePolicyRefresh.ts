import type { QueryClient } from '@tanstack/react-query';

/**
 * What a saved or deleted node policy makes stale, by prefix (A-283).
 *
 *   ['node-policies']    the list itself;
 *   ['nodes']            the fleet lists (squads read `policyId` off them);
 *   ['node']             each node page: a delete sets `policyId` to null on
 *                        every node that ran it, and the page read it there;
 *   ['policy-drawing']   each node's drawing of its policy, now of another one.
 *
 * Only the first two were reset: within the 30 s staleTime the Routes tab of a
 * node kept the deleted policy's id and drawing until F5.
 */
export const NODE_POLICY_STALE_KEYS: readonly (readonly string[])[] = [['node-policies'], ['nodes'], ['node'], ['policy-drawing']];

export function refreshAfterNodePolicyChange(qc: QueryClient): void {
  for (const queryKey of NODE_POLICY_STALE_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
}
