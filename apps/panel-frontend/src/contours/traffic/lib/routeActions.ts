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
