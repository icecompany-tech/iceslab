import { isRoutingPresetId, type RoutingPresetId } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { getSubscriptionSettings } from '../settings/settings.service.js';
import { matchRuleForUserAgent } from '../srr/srr.service.js';

/**
 * What this user actually gets, as opposed to what is written on their row.
 *
 * Both halves of the answer are computed at serve time out of three or four
 * places, and neither is visible anywhere: the routing preset falls through
 * user -> squad -> panel, and the format is chosen per REQUEST from the
 * client's User-Agent. So a card that shows the stored value shows the wrong
 * thing for most users, and an operator debugging "why is this one routed
 * differently" has nothing to look at.
 */

export type RoutingSource = 'user' | 'squad' | 'global';

export interface UserDeliveryDto {
  routing: {
    /** What a request from this user resolves to right now. */
    effective: RoutingPresetId;
    /** Which tier won, so the card can say where to go to change it. */
    source: RoutingSource;
    /** The per-user override, null = inherits. */
    user: RoutingPresetId | null;
    /** The squads' single distinct override, null = none or they disagree. */
    squad: RoutingPresetId | null;
    /**
     * The squads carry MORE than one distinct override.
     *
     * resolveSquadRouting answers null both for "nobody set one" and for "they
     * disagree", which is right for serving (fall through either way) and wrong
     * for a screen: the second case is a misconfiguration an operator wants to
     * see, and it is otherwise indistinguishable from the ordinary case.
     */
    squadConflict: boolean;
    /** The panel-wide default, the floor everything falls through to. */
    global: RoutingPresetId;
  };
  format: {
    /** The format the last real request was answered in, or the panel's
     *  fallback when this user has never fetched their subscription. */
    effective: string;
    /** `srr` = a rule matched the client's User-Agent, `default` = nothing
     *  matched, or the user has never been seen. */
    source: 'srr' | 'default';
    /** Name of the rule that matched, so the operator can open it. */
    ruleName: string | null;
    /** What their client called itself last time. The evidence behind the two
     *  fields above; without it `effective` is unverifiable. */
    lastUserAgent: string | null;
    lastRequestedAt: string | null;
  };
}

/**
 * The format nothing else claims.
 *
 * Mirrors the last rung of the route handler's chain (explicit ?format=, then
 * an SRR rule, then the Accept heuristic, then this): a client that names
 * neither a format nor a recognised User-Agent gets the universal base64 list.
 */
const FALLBACK_FORMAT = 'plain';

export async function getUserDelivery(userId: string): Promise<UserDeliveryDto | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      routingPreset: true,
      groupMembers: { select: { group: { select: { routingPreset: true } } } },
    },
  });
  if (!user) return null;

  const [settings, lastRequest] = await Promise.all([
    getSubscriptionSettings(),
    // The newest row of the audit trail the subscription route already writes.
    // Indexed on (userId, requestedAt desc), so this is a one-row lookup.
    prisma.subscriptionRequestHistory.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      select: { userAgent: true, requestedAt: true },
    }),
  ]);

  const distinctSquad = [
    ...new Set(
      user.groupMembers
        .map((m) => m.group.routingPreset)
        .filter((p): p is RoutingPresetId => p !== null && isRoutingPresetId(p)),
    ),
  ];
  const squad = distinctSquad.length === 1 ? distinctSquad[0]! : null;
  const own = isRoutingPresetId(user.routingPreset) ? user.routingPreset : null;

  const effective = own ?? squad ?? settings.routingPreset;
  const source: RoutingSource = own ? 'user' : squad ? 'squad' : 'global';

  const rule = await matchRuleForUserAgent(lastRequest?.userAgent);

  return {
    routing: {
      effective,
      source,
      user: own,
      squad,
      squadConflict: distinctSquad.length > 1,
      global: settings.routingPreset,
    },
    format: {
      effective: rule?.format ?? FALLBACK_FORMAT,
      source: rule ? 'srr' : 'default',
      ruleName: rule?.name ?? null,
      lastUserAgent: lastRequest?.userAgent ?? null,
      lastRequestedAt: lastRequest?.requestedAt.toISOString() ?? null,
    },
  };
}
