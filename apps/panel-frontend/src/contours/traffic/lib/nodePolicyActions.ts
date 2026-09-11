import type { PolicyActionKind } from '@/lib/domain/nodePolicies';
import { CYAN, MOSS, RED, VIOLET } from '@/contours/traffic/lib/colors';

/**
 * What a node policy action is CALLED, and what colour it wears.
 *
 * The one rule this file exists to enforce: the word `direct` never reaches the
 * screen. On the device (layer A) it means "around the tunnel, out of the
 * user's own address"; on the node (layer B) it means "out of the node's
 * address". Opposite outcomes for the person whose traffic it is, under one
 * word. So layer A and layer B never share a name in the interface, and the
 * wire value stays in the payload where it belongs.
 *
 * Labels come from the artboard verbatim and are not translated back into
 * protocol vocabulary anywhere.
 */

/** i18n key per action, under `routes.nodeAction`. */
export const ACTION_KEY: Record<PolicyActionKind, string> = {
  block: 'toNowhere',
  warp: 'viaWarp',
  direct: 'fromOurIp',
  cascade: 'viaDirection',
};

/** Each action keeps one colour across the whole screen, so a list of twenty
 *  rules can be read by its dots before any of the words are. */
export const ACTION_TONE: Record<PolicyActionKind, string> = {
  block: RED,
  warp: VIOLET,
  direct: MOSS,
  cascade: CYAN,
};

/** The order the picker offers them in: the two that need nothing set up
 *  first, then the two that depend on the node having something provisioned. */
export const ACTION_ORDER: PolicyActionKind[] = ['block', 'direct', 'warp', 'cascade'];
