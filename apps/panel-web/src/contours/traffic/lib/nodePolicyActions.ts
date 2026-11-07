import type { PolicyActionKind } from '@/lib/old/nodePolicies';

/**
 * What a node policy action is called. The word `direct` never reaches the screen: on the
 * device it means around the tunnel, on the node it means out of the node's address, opposite
 * outcomes under one word, so the wire value stays in the payload.
 */
export const ACTION_KEY: Record<PolicyActionKind, 'toNowhere' | 'viaWarp' | 'fromOurIp' | 'viaDirection'> = {
  block: 'toNowhere',
  warp: 'viaWarp',
  direct: 'fromOurIp',
  cascade: 'viaDirection',
};

/** The two that need nothing set up first, then the two that depend on the node. */
export const ACTION_ORDER: PolicyActionKind[] = ['block', 'direct', 'warp', 'cascade'];
