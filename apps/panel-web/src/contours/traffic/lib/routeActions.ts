import type { RouteAction } from '@/lib/old/routePolicies';

export const ACTIONS: RouteAction[] = ['block', 'direct', 'warp', 'proxy'];

/** What a device can be told to do; narrower than a node's list. */
export const DEVICE_ACTIONS: RouteAction[] = ['direct', 'block', 'proxy'];
