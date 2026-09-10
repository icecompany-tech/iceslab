import { CYAN, MOSS, RED, VIOLET } from '@/contours/traffic/lib/colors';
import type { RouteAction } from '@/lib/domain/routePolicies';
export const ACTIONS: RouteAction[] = ['block', 'direct', 'warp', 'proxy'];

export const ACTION_W = 230;

export const ACTION_TONE: Record<RouteAction, string> = {
  block: RED,
  direct: MOSS,
  warp: VIOLET,
  proxy: CYAN,
};
/** Everything a node can do with traffic it has already received. */

/** What a device can be told to do; narrower than a node's list. */
export const DEVICE_ACTIONS: RouteAction[] = ['direct', 'block', 'proxy'];
