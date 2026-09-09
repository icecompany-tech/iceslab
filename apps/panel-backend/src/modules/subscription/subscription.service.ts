import { isRoutingPresetId, type RoutingPresetId } from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import {
  lookupClientCountry,
  rankNodesForUser,
  rendezvousOrder,
  type NodeForRanking,
} from './node-selection.js';
// Slice 27 follow-up: enabledProtocols is no longer consulted, squad ACL is
// the single source of truth for which protocols a user sees. The column is
// kept on the User row for backwards-compat but never filters subscription
// output.
import { subscriptionServerName } from '../../lib/util/country-flag.js';
import { allocatePeer } from '../amneziawg/amneziawg.service.js';
import { getHiddenCascadeNodeIds, getRouteProfilesByEntryNode } from '../cascades/cascade.service.js';
import { isAutoRouteTag } from '../cascades/cascade.config.js';
import { getSubscriptionSettings } from '../settings/settings.service.js';
import { getCachedBindings, bindingsCacheKey } from './subscription.bindings-cache.js';
import { buildNaiveUri } from '../../core-adapters/naive/index.js';
import { deriveTuicPassword, deriveAnytlsPassword, deriveShadowtlsPassword, deriveSsPassword } from '../../lib/auth/credentials.js';
import {
  buildAnytlsUri,
  buildHysteriaUri,
  buildMieruUri,
  buildMtprotoTmeUri,
  buildMtprotoUri,
  buildShadowsocksUri,
  buildSubscriptionJson,
  buildTrojanRealityUri,
  buildTuicUri,
  buildVlessRealityUri,
  buildVmessUri,
  encodePlainList,
  hostFromAddress,
  mtprotoSecret,
  withUriRemark,
  type ShadowsocksMethod,
  type SubscriptionEndpoint,
  type SubscriptionJsonResponse,
} from './subscription.formats.js';
import { endpointId } from './endpoint-identity.js';
import { withVlessRouteTag } from './formats/xrayjson.js';

// ───── Domain errors ─────

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found');
    this.name = 'SubscriptionNotFoundError';
  }
}

export class SubscriptionForbiddenError extends Error {
  constructor(public reason: 'REVOKED' | 'DISABLED' | 'EXPIRED' | 'LIMITED') {
    super(`Subscription is ${reason.toLowerCase()}`);
    this.name = 'SubscriptionForbiddenError';
  }
}

/**
 * How long a node may be `unreachable` before it stops being served.
 *
 * Sized against the poller: it ticks every 30 seconds, so this is three
 * consecutive failures. Short enough that a genuinely dead node leaves within
 * the 90 seconds the acceptance criterion names, long enough that a single
 * missed tick (or a brief panel-to-node network blip) changes nothing.
 */
const UNREACHABLE_GRACE_MS = 90_000;

/**
 * Default cap on interchangeable entries per profile: none.
 *
 * This was a hard-coded 3 until 2026-08-10. It read as a bug from the operator
 * side and was reported as one: a node was deployed, healthy and serving, and
 * simply did not appear in a subscription, with nothing anywhere saying why.
 * Whatever a capped pool buys (a leaked subscription exposing a slice of the
 * entry surface rather than all of it) is not worth an operator doubting
 * whether their own fleet works.
 *
 * The mechanism is kept and is now opt-in through `subscriptionEntryPoolSize`.
 * When set, selection is by rendezvous hash: stable per person, and a node
 * dropping out reshuffles only its own users.
 */
const ENTRY_POOL_SIZE_DEFAULT = 0;

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  /** Slice 28: when set, limit subscription to top-N nodes ranked by
   *  region match (against `cfCountry`) and current utilization. <1 means
   *  "no filter" (default behaviour: return every eligible endpoint). */
  topN?: number;
  /** `CF-IPCountry` header value, passed through from the route handler.
   *  Used by `lookupClientCountry` for the geo-aware ranker. Empty / `XX`
   *  is treated as "country unknown" and the ranker falls back to
   *  utilization-only ordering. */
  cfCountry?: string;
}

export interface SubscriptionResult {
  endpoints: SubscriptionEndpoint[];
  textPlain: string;
  json: SubscriptionJsonResponse;
  // R3-a - effective routing override from the user's squads, or null to
  // inherit the panel-wide default. The single distinct non-null preset across
  // the user's squads; null when no squad overrides OR they conflict.
  squadRoutingPreset: RoutingPresetId | null;
  // R3 - the user's explicit per-user routing override, or null to inherit
  // (squad -> global -> default). Highest precedence below the ?routing= query.
  userRoutingPreset: RoutingPresetId | null;
}

/**
 * R3-a - reduce a user's per-squad routing overrides to one effective preset.
 * Rule: the single distinct VALID preset across their squads wins; zero
 * overrides, or a conflict (>1 distinct), returns null = inherit the panel-wide
 * default. Invalid/garbage values are ignored. Pure (no DB) for testing.
 */
export function resolveSquadRouting(
  overrides: (string | null)[],
): RoutingPresetId | null {
  const distinct = [
    ...new Set(overrides.filter((p): p is RoutingPresetId => p !== null && isRoutingPresetId(p))),
  ];
  return distinct.length === 1 ? distinct[0]! : null;
}

// ───── Per-protocol config shapes (mirror inbounds.schemas.ts) ─────

interface XrayInboundConfig {
  realityDest: string;
  realityServerNames: string[];
  realityShortIds: string[];
  realityPrivateKey: string;
  realityPublicKey: string;
  realityMode?: 'steal-others' | 'self-steal';
  flow: string;
  fingerprint: string;
  network: 'raw' | 'xhttp' | 'ws' | 'grpc';
  path?: string;
  host?: string;
  serviceName?: string;
}

interface AmneziawgObfuscation {
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  /** I1-I5: v2.0 mimicry signature packets (hex). Optional, Zod
   *  defaults to empty string when absent, so existing profiles
   *  saved before the v2.0 alignment still parse cleanly. */
  i1?: string;
  i2?: string;
  i3?: string;
  i4?: string;
  i5?: string;
}

interface AmneziawgInboundConfig {
  subnet: string;
  serverPrivateKey: string;
  serverPublicKey: string;
  obfuscation: AmneziawgObfuscation;
}

interface NaiveInboundConfig {
  hostname: string;
  tlsEmail: string;
  masqueradeRoot: string;
}

/**
 * A4: expand one endpoint into the share-link URIs the plain / base64
 * subscription emits. A balancer-cascade entry (an xray endpoint carrying
 * `cascadeExits`) yields one re-tagged URI per exit: the userinfo UUID gets
 * bytes 7-8 set to exit index+1 (xray reads them as vlessRoute, auth ignores
 * them) and the `#remark` becomes the exit name. Every server stays a plain URI,
 * at the cost of the per-config split-routing only the JSON form carries.
 *
 * This used to say the JSON array cannot be pinged in Happ, so URIs were the
 * only format that showed latency. Not true, checked in the field 2026-08-16.
 *
 * vmess is skipped (its UUID lives inside a base64 blob, not the userinfo, so a
 * plain string swap can't reach it) and returned as its single original URI.
 * Every non-entry endpoint returns its one original URI unchanged.
 */
/**
 * How the client shows one transport, for telling two otherwise identical
 * cascade lines apart. Short on purpose: it sits at the end of a label.
 */
const TRANSPORT_LABEL: Record<string, string> = {
  raw: 'TCP',
  xhttp: 'XHTTP',
  ws: 'WS',
  grpc: 'gRPC',
  httpupgrade: 'HTTPUpgrade',
  kcp: 'KCP',
};

const PROTOCOL_LABEL: Record<string, string> = {
  hysteria: 'Hysteria2',
  xray: 'Xray',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  shadowsocks: 'Shadowsocks',
  mtproto: 'MTProto',
  mieru: 'Mieru',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  shadowtls: 'ShadowTLS',
};

/**
 * What can be said about an endpoint to tell it apart from a namesake, best
 * first. Only consulted when something actually collides, and only the entry
 * that DOES separate the group is used: appending "· Hysteria2" to two rows that
 * are both Hysteria2 lengthens them without telling anyone anything.
 */
function endpointDescriptors(e: SubscriptionEndpoint): (string | undefined)[] {
  return [
    e.protocol === 'xray' ? TRANSPORT_LABEL[e.network ?? 'raw'] : PROTOCOL_LABEL[e.protocol],
    e.hostRemark && e.hostRemark !== 'Default' ? e.hostRemark : undefined,
    String(e.port),
  ];
}
const DESCRIPTOR_LEVELS = 3;

function refineLabels(group: SubscriptionEndpoint[], level: number): void {
  if (group.length < 2) return;
  for (let l = level; l < DESCRIPTOR_LEVELS; l++) {
    const values = group.map((e) => endpointDescriptors(e)[l]);
    if (new Set(values).size < 2) continue;
    group.forEach((e, i) => {
      const v = values[i];
      if (v) e.nodeName = `${e.nodeName} · ${v}`;
    });
    const byLabel = new Map<string, SubscriptionEndpoint[]>();
    for (const e of group) {
      const bucket = byLabel.get(e.nodeName) ?? [];
      bucket.push(e);
      byLabel.set(e.nodeName, bucket);
    }
    for (const bucket of byLabel.values()) refineLabels(bucket, l + 1);
    return;
  }
  // Same node, same transport, same host, same port: nothing about the endpoint
  // separates it from its namesake any more, so its own identity has to.
  for (const e of group) e.nodeName = `${e.nodeName} · ${endpointId(e).slice(0, 4)}`;
}

/**
 * Make every server line in one subscription readably different.
 *
 * The label comes from `subscriptionServerName`, which is the host's remark or,
 * for a host nobody named, the node's own name. Two bindings on one node with
 * unnamed hosts therefore read the same, and the client shows two rows a person
 * has no way to choose between (reported by the operator 2026-08-29). It also
 * used to matter structurally: sing-box tags and Clash proxy names are built
 * from this string, and a duplicate there is a duplicate identifier.
 *
 * The predecessor of this function numbered the duplicates - "ru-01", "ru-01 2"
 * - which is unique but says nothing, and it did so in list order, so adding a
 * binding could move the "2" onto a different server. Here the whole colliding
 * group is given the first fact that actually separates it, so the suffix
 * carries meaning ("· XHTTP", "· gRPC") and depends on the endpoints rather than
 * on their order.
 *
 * The link's own name is refreshed alongside the label, and this is the reason
 * the function exists at all rather than the caller doing it inline: URIs are
 * built one binding at a time, before there is a list to compare against.
 */
export function disambiguateEndpointLabels(endpoints: SubscriptionEndpoint[]): void {
  const before = new Map<SubscriptionEndpoint, string>();
  const groups = new Map<string, SubscriptionEndpoint[]>();
  for (const e of endpoints) {
    before.set(e, e.nodeName);
    const bucket = groups.get(e.nodeName) ?? [];
    bucket.push(e);
    groups.set(e.nodeName, bucket);
  }
  for (const group of groups.values()) refineLabels(group, 0);

  // A suffixed label can in principle land on a label somebody else already had
  // ("X" + "· 443" meeting a host literally named "X · 443"). Vanishingly rare,
  // but the uniqueness has to be a guarantee rather than a likelihood, because
  // the formats build identifiers out of it.
  const used = new Set<string>();
  for (const e of endpoints) {
    if (!used.has(e.nodeName)) {
      used.add(e.nodeName);
      continue;
    }
    const id = endpointId(e).slice(0, 4);
    let candidate = `${e.nodeName} · ${id}`;
    for (let n = 2; used.has(candidate); n++) candidate = `${e.nodeName} · ${id} ${n}`;
    e.nodeName = candidate;
    used.add(candidate);
  }

  for (const e of endpoints) {
    if (e.nodeName !== before.get(e)) e.uri = withUriRemark(e.uri, e.nodeName);
  }
}

/**
 * Make every cascade line in one subscription distinguishable.
 *
 * A cascade's entry is a POOL, and every node in it offers the same set of
 * exits, so two entries produce the same label twice: a subscriber sees "ru →
 * NL" and "ru → NL" and has no way to tell which is which. It got worse the
 * moment pooled entries started expanding correctly (2026-08-15): before that
 * the second entry was leaking into subscriptions as a plain direct server,
 * which was a bigger problem and hid this one.
 *
 * Only actual collisions are touched. A unique label stays exactly as it is,
 * because a differentiator on every line is noise: the transport matters to the
 * reader only when it is the thing that differs.
 *
 * This replaces two separate places that each appended the host remark blindly.
 * They could not see collisions, only their own endpoint, so they suffixed
 * labels that needed nothing and left the ones that did.
 */
/**
 * One line per cascade profile, not one per way in.
 *
 * Every entry of a pool offers the same profiles, so a cascade with two entries
 * showed each of its lines twice: two rows called Auto, two called "ru → NL",
 * two called "ru → SE". None of that is a choice a subscriber can reason about.
 * The country is already in the label, the exit is already chosen by the entry
 * node, and the only thing that differs between the duplicates is which of OUR
 * machines the traffic enters through - which they have no way to judge and, when
 * both entries share a transport, no way to even tell apart.
 *
 * A share link is one server - host, port, transport - so this cannot be fixed
 * by making a row balance the way IN; that needs a client-side balancer, which
 * only the config formats can carry. What a URI list can do is stop offering the
 * same thing twice.
 *
 * Two properties matter and both come from the assignment rule below:
 *
 *  - stable per person. Which entry carries a line is a pure function of (user,
 *    entry) via rendezvous hash, so a subscription refresh does not move anyone;
 *    on a router, a move drops every live connection.
 *  - spread. Lines are dealt across the entries by tag rather than all landing
 *    on the winner, so a pool keeps doing its job: the population is spread, and
 *    a subscriber whose entry is blocked still has other rows on the other one.
 *    Modulo by TAG, not by position in the list, so adding or deleting a
 *    direction leaves everybody else's rows exactly where they were.
 *
 * The pool's redundancy does get quieter here: a user no longer sees every way
 * into a country, so if the entry under "ru → NL" is blocked for them they
 * cannot switch to the other one by hand, only to another row. That is the cost
 * of the short list, and it is why the spread above is part of the feature
 * rather than a nicety.
 */
export function collapseCascadeLines(
  endpoints: SubscriptionEndpoint[],
  userId: string,
): void {
  // An endpoint is identified by where it actually points: two hosts on one node
  // are two different ways in, and each is a candidate on its own.
  //
  // The label is part of that string, and since 2026-08-30 it is the label AFTER
  // disambiguation (the caller runs that first, and must). For entries that used
  // to read alike the key therefore changed, and the rendezvous order below is a
  // function of the key, so which entry carries which line moved once for those
  // subscribers - on a router a move drops every live connection. It happens on
  // the first refresh after the change and not again. Keying this on the
  // endpoint identity instead, which no rename can reach, is tracked separately
  // (cascade-entry-key-label-af26): that reshuffles EVERYONE, so it waits for a
  // window where a reshuffle is acceptable.
  const keyOf = (e: SubscriptionEndpoint): string =>
    `${e.nodeName}|${e.host}|${e.port}|${e.protocol === 'xray' ? (e.network ?? '') : ''}`;

  // cascadeId -> entry key -> endpoint
  const entriesByCascade = new Map<string, Map<string, SubscriptionEndpoint>>();
  for (const e of endpoints) {
    for (const x of e.cascadeExits ?? []) {
      if (!x.cascadeId) continue;
      const perCascade = entriesByCascade.get(x.cascadeId) ?? new Map<string, SubscriptionEndpoint>();
      perCascade.set(keyOf(e), e);
      entriesByCascade.set(x.cascadeId, perCascade);
    }
  }

  for (const [cascadeId, perCascade] of entriesByCascade) {
    if (perCascade.size < 2) continue;
    const order = rendezvousOrder(
      [...perCascade.keys()].map((id) => ({ id, name: id, regionCode: null, maxUsers: null })),
      userId,
    ).map((n) => n.id);

    // Which entries can actually serve each tag. Squad ACLs are resolved per
    // entry, so two entries of one pool may legitimately offer different sets,
    // and a line has to be dealt to an entry that carries it.
    const offeredBy = new Map<number, Set<string>>();
    for (const [key, e] of perCascade) {
      for (const x of e.cascadeExits ?? []) {
        if (x.cascadeId !== cascadeId) continue;
        const set = offeredBy.get(x.tag) ?? new Set<string>();
        set.add(key);
        offeredBy.set(x.tag, set);
      }
    }

    const holderOf = new Map<number, string>();
    for (const [tag, offering] of offeredBy) {
      // Deal from a per-tag offset so consecutive directions land on different
      // entries; walk the rendezvous order from there to the first entry that
      // offers this tag.
      const start = tag % order.length;
      for (let i = 0; i < order.length; i++) {
        const key = order[(start + i) % order.length]!;
        if (offering.has(key)) {
          holderOf.set(tag, key);
          break;
        }
      }
    }

    for (const [key, e] of perCascade) {
      e.cascadeExits = (e.cascadeExits ?? []).filter(
        (x) => x.cascadeId !== cascadeId || holderOf.get(x.tag) === key,
      );
    }
  }

  /**
   * An entry left with no profiles must LEAVE the subscription, not stay.
   *
   * An endpoint carrying an empty exit list is emitted as an ordinary direct
   * server, and that is exactly how a subscriber ends up egressing in the ENTRY
   * country while their client shows a cascade line - the leak that cost a day
   * on 2026-08-15. With more entries than lines, dealing them out empties one,
   * and it has nothing left to offer anyway: every line it used to carry is on
   * another entry now.
   */
  for (let i = endpoints.length - 1; i >= 0; i--) {
    const e = endpoints[i]!;
    if (e.cascadeExits && e.cascadeExits.length === 0) endpoints.splice(i, 1);
  }
}

export function disambiguateCascadeLabels(endpoints: SubscriptionEndpoint[]): void {
  const seen = new Map<string, number>();
  for (const e of endpoints) {
    for (const x of e.cascadeExits ?? []) {
      seen.set(x.label, (seen.get(x.label) ?? 0) + 1);
    }
  }
  for (const e of endpoints) {
    for (const x of e.cascadeExits ?? []) {
      if ((seen.get(x.label) ?? 0) < 2) continue;
      const network = e.protocol === 'xray' ? e.network : undefined;
      const suffix =
        (network ? TRANSPORT_LABEL[network] : undefined) ??
        (e.hostRemark && e.hostRemark !== 'Default' ? e.hostRemark : e.nodeName);
      x.label = `${x.label} · ${suffix}`;
    }
  }
}

export function expandEndpointUris(e: SubscriptionEndpoint): string[] {
  if (
    e.protocol !== 'xray' ||
    !e.cascadeExits ||
    e.cascadeExits.length === 0 ||
    e.subprotocol === 'vmess'
  ) {
    return e.uri ? [e.uri] : [];
  }
  // vless:// and trojan:// both put the UUID in the userinfo, so replacing the
  // first occurrence of it retargets the link. Strip the original #remark first.
  const hashIdx = e.uri.indexOf('#');
  const base = hashIdx === -1 ? e.uri : e.uri.slice(0, hashIdx);
  return e.cascadeExits.map((profile) => {
    const tagged = base.replace(e.uuid, withVlessRouteTag(e.uuid, profile.tag));
    // The label is already unique across this subscription (see
    // disambiguateCascadeLabels); nothing to append here.
    return `${tagged}#${encodeURIComponent(profile.label)}`;
  });
}

/**
 * Resolve a subscription token to a list of per-inbound endpoints.
 *
 * Walks every enabled inbound on every active node, filters by the user's
 * `enabledProtocols`, and emits one structured endpoint per match. The
 * endpoint shape carries everything the format-specific builders (clash /
 * singbox / wgconf / xrayjson) need; the route handler picks the format.
 *
 * AmneziaWG IP allocation is lazy: the first time a user hits an AmneziaWG
 * inbound their IP gets persisted in `amneziawg_peers`. Subsequent calls
 * return the same row.
 *
 * Side effect: writes a row to `subscription_request_history` for audit.
 * Failures of that write are logged but do not fail the request.
 */
export async function generateSubscription(
  token: string,
  ctx: RequestContext = {},
): Promise<SubscriptionResult> {
  const user = await prisma.user.findFirst({
    where: { subscriptionToken: token, deletedAt: null },
    include: { traffic: true },
  });
  if (!user) throw new SubscriptionNotFoundError();

  if (user.subRevokedAt) throw new SubscriptionForbiddenError('REVOKED');
  switch (user.status) {
    case 'active':
      break;
    case 'disabled':
      throw new SubscriptionForbiddenError('DISABLED');
    case 'expired':
      throw new SubscriptionForbiddenError('EXPIRED');
    case 'limited':
      throw new SubscriptionForbiddenError('LIMITED');
    default:
      throw new SubscriptionForbiddenError('DISABLED');
  }

  // Slice 27: Squad ACL is now profile-level. Visible bindings are the
  // UNION of bindings of every profile attached to a group the user is a
  // member of. If the user has zero memberships the subscription is empty
  // (createUser auto-adds them to "All", so this is only reachable if
  // someone clears memberships via raw SQL).
  //
  // B6 - the binding set is a pure function of the user's SQUAD SET, so we
  // resolve the (cheap, indexed) group-id list first and serve the heavy
  // nested query from a squad-set-keyed in-process cache shared by every user
  // in the same squads. Membership changes need no busting, the user just
  // maps to a different key.
  // Pull the group ids AND each group's routingPreset in one query: the id list
  // keys the binding cache below, and the presets feed resolveSquadRouting at the
  // end. Previously the routing preset was a SECOND `group.findMany` over the
  // identical squad set, i.e. a redundant round-trip on every /sub poll.
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    select: { groupId: true, group: { select: { routingPreset: true } } },
  });
  const groupIds = memberships.map((g) => g.groupId);

  const cachedBindings =
    groupIds.length === 0
      ? []
      : await getCachedBindings(bindingsCacheKey(groupIds), Date.now(), () =>
          prisma.profileNodeBinding.findMany({
            where: {
              enabled: true,
              profile: {
                enabled: true,
                groupProfiles: { some: { groupId: { in: groupIds } } },
              },
              node: {
                deletedAt: null,
                status: { not: 'disabled' },
                // Liveness, with hysteresis. `unreachable` means "the panel
                // could not reach the AGENT", not "the proxy is down": the
                // mTLS control channel and the user-facing port fail
                // independently. Dropping a node the moment that flag appears
                // would turn one bad minute between panel and fleet into every
                // user losing every endpoint at once.
                //
                // So a node leaves the subscription only once it has been
                // unreachable for longer than UNREACHABLE_GRACE_MS, and
                // returns on the first successful poll (the poller moves
                // lastStatusChange when it flips back).
                OR: [
                  { status: { not: 'unreachable' } },
                  { lastStatusChange: null },
                  { lastStatusChange: { gt: new Date(Date.now() - UNREACHABLE_GRACE_MS) } },
                ],
              },
            },
            include: {
              profile: { select: { id: true, protocol: true, config: true } },
              node: {
                select: {
                  id: true,
                  name: true,
                  address: true,
                  // B3/G - node FQDN, used as the REALITY serverName/SNI for
                  // self-steal xray endpoints (per-node, must resolve to node IP).
                  domain: true,
                  // Drives the flag emoji in the server name a client displays.
                  countryCode: true,
                  createdAt: true,
                  // Capacity hint, used as the WEIGHT when picking which
                  // entries of a pool a user gets: a node with twice the cap
                  // should take twice the share. Null = treated as the default.
                  maxUsers: true,
                  // Slice 28: region.code drives the "same-region bonus" in the
                  // smart-selection ranker. Null when admin hasn't tagged a region;
                  // ranker still works (utilization-only score for that node).
                  region: { select: { code: true } },
                },
              },
              // Slice 30: one binding fans out into N enabled hosts. Order them
              // by `priority` so subscription URL ordering is admin-controlled.
              hosts: {
                where: { enabled: true },
                orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
                // Which squads narrowed themselves to this specific host.
                // Read here rather than as a second query so the whole ACL
                // decision stays inside the cached binding set.
                include: { groupHosts: { select: { groupId: true } } },
              },
            },
            orderBy: [{ port: 'asc' }],
          }),
        );
  // Shallow copy - the cached array is shared across requests/users, and the
  // sort here plus the topN filter below both mutate the array in place.
  const bindings = [...cachedBindings];

  // Per-squad host allow-list. A squad grants PROFILES, and every host of a
  // granted profile came with it, which made "this tier sees two countries,
  // that one sees all" impossible without duplicating the profile.
  //
  // OPT-IN, the same rule the cascade exit allow-list uses: a squad with NO
  // rows restricts nothing. Only squads that actually narrowed themselves are
  // collected here, so a user in a narrowed squad and an unrestricted one
  // still sees everything, which is the permissive-union behaviour the rest of
  // the ACL already has.
  const narrowedSquads = new Set(
    (
      await prisma.groupHost.findMany({
        where: { groupId: { in: groupIds } },
        select: { groupId: true },
        distinct: ['groupId'],
      })
    ).map((r) => r.groupId),
  );
  if (narrowedSquads.size > 0) {
    // A host is served when at least one of the user's squads reaches it:
    // either a squad that never narrowed itself, or one that named this host.
    const unrestricted = groupIds.some((g) => !narrowedSquads.has(g));
    if (!unrestricted) {
      for (const b of bindings) {
        b.hosts = b.hosts.filter((h) =>
          h.groupHosts.some((gh) => groupIds.includes(gh.groupId)),
        );
      }
    }
  }
  // Sort by node createdAt then port so the order across formats stays stable.
  bindings.sort((a, b) => {
    const t = a.node.createdAt.getTime() - b.node.createdAt.getTime();
    return t !== 0 ? t : a.port - b.port;
  });

  // Cascade leak fix: a non-entry hop (transit/exit) of an enabled cascade is
  // chain-internal and must NOT be a directly-connectable endpoint, else the
  // client bypasses the chain straight to the exit. Drop those bindings here -
  // after the squad-keyed binding-cache read, so the cache stays cascade-blind
  // and a cascade toggle doesn't need to bust it. Done before the topN ranker
  // so a hidden exit can't be ranked in.
  const hiddenCascadeNodes = await getHiddenCascadeNodeIds();
  if (hiddenCascadeNodes.size > 0) {
    const kept = bindings.filter((b) => !hiddenCascadeNodes.has(b.node.id));
    bindings.length = 0;
    bindings.push(...kept);
  }

  // Slice 28: smart node selection. When the route passed topN+cfCountry,
  // we rank distinct nodes by region match + utilization, take the top-N,
  // and filter bindings down to those. Falls through cleanly when topN<1
  // or cfCountry empty: ranker just orders by utilization, and the topN
  // slice is a no-op when N >= node count.
  if (typeof ctx.topN === 'number' && ctx.topN > 0 && bindings.length > 0 && ctx.ip) {
    const country = await lookupClientCountry(ctx.ip, { cfCountry: ctx.cfCountry });
    // Dedupe nodes (one binding per row → many per node) and collect
    // current load. currentUsers comes from a cheap groupBy query.
    const seen = new Map<string, NodeForRanking>();
    for (const b of bindings) {
      if (!seen.has(b.node.id)) {
        seen.set(b.node.id, {
          id: b.node.id,
          name: b.node.name,
          regionCode: b.node.region?.code ?? null,
          currentUsers: null,
        });
      }
    }
    const ranked = rankNodesForUser([...seen.values()], country, ctx.topN);
    const keep = new Set(ranked.map((n) => n.id));
    const filtered = bindings.filter((b) => keep.has(b.node.id));
    // Preserve original order within the kept set so format output is stable.
    bindings.length = 0;
    bindings.push(...filtered);
  }

  // Entry order, and optionally an entry cap.
  //
  // Nodes serving the SAME profile are interchangeable ways in, so the order
  // they arrive in decides which one most clients actually dial: apps offer the
  // first as the default and few subscribers ever change it. One order for
  // everybody therefore herds the whole userbase onto whichever node the query
  // happened to return first, while the rest idle.
  //
  // So the list is ordered by rendezvous hash on (user, node). Every subscriber
  // still receives every node they are entitled to - the operator deployed it,
  // it has to be there - but they each start somewhere different, and the
  // ordering is a pure function of (user, node), which buys two things: a
  // subscriber's router does not wander on every refresh, and a node dropping
  // out reshuffles only the people who were on it. Sorting by live load would
  // do neither: it moves everyone at once, then moves them back when the metric
  // catches up.
  //
  // `subscriptionEntryPoolSize` additionally caps the list per profile. Off by
  // default (see ENTRY_POOL_SIZE_DEFAULT); an operator who would rather a leaked
  // subscription expose a slice of the entry surface than all of it turns it on.
  //
  // Liveness is already applied by the query above, so this only ever orders
  // nodes that are actually being served.
  const entryPoolSize = (await getSubscriptionSettings()).entryPoolSize ?? ENTRY_POOL_SIZE_DEFAULT;
  if (bindings.length > 0) {
    const byProfile = new Map<string, typeof bindings>();
    for (const b of bindings) {
      const list = byProfile.get(b.profile.id) ?? [];
      list.push(b);
      byProfile.set(b.profile.id, list);
    }
    const ordered: typeof bindings = [];
    for (const list of byProfile.values()) {
      const nodes = [...new Map(list.map((b) => [b.node.id, b.node])).values()].map((n) => ({
        id: n.id,
        name: n.name,
        regionCode: null,
        maxUsers: n.maxUsers ?? null,
      }));
      let ranked = rendezvousOrder(nodes, user.id);
      if (entryPoolSize > 0) ranked = ranked.slice(0, entryPoolSize);
      const rank = new Map(ranked.map((n, i) => [n.id, i]));
      const kept = list.filter((b) => rank.has(b.node.id));
      // Sort is stable, so several hosts sharing one node keep the relative
      // order the operator gave them and only the nodes move.
      kept.sort((a, b) => rank.get(a.node.id)! - rank.get(b.node.id)!);
      ordered.push(...kept);
    }
    bindings.length = 0;
    bindings.push(...ordered);
  }

  // A4: which of these nodes are cascade entries + the route profiles they
  // offer. One query for the whole binding set; the xray branch attaches the
  // match so buildXrayJsonArray can expand that endpoint into one config per
  // profile. Chains take part too, but only once a policy is granted (see
  // getRouteProfilesByEntryNode).
  // Which squads actually hand out each entry node. A route policy belongs to
  // the squad that granted it, so it may only add variants to entries THAT
  // squad hands out: without this, one squad's "no ads" grant appeared on
  // another squad's exit, which the operator never configured and could not
  // switch off (field 2026-08-08). Built from the same host grants the ACL
  // above uses, so the two can't drift.
  //
  // Unrestricted squads (no host rows at all) reach every entry, matching the
  // opt-in convention the host and exit allow-lists already follow.
  const entryReach = new Map<string, Set<string>>();
  for (const b of bindings) {
    let reach = entryReach.get(b.node.id);
    if (!reach) {
      reach = new Set<string>();
      entryReach.set(b.node.id, reach);
    }
    for (const g of groupIds) {
      if (!narrowedSquads.has(g) || b.hosts.some((h) => h.groupHosts.some((gh) => gh.groupId === g)))
        reach.add(g);
    }
  }
  const balancerExits = await getRouteProfilesByEntryNode(
    [...new Set(bindings.map((b) => b.node.id))],
    groupIds,
    entryReach,
  );

  const endpoints: SubscriptionEndpoint[] = [];
  for (const b of bindings) {
    // Resolve deployable config: profile.config + binding.overrides.
    const baseConfig = (b.profile.config ?? {}) as Record<string, unknown>;
    const ovr = (b.overrides ?? {}) as Record<string, unknown>;
    const cfgMerged = { ...baseConfig, ...ovr };

    // Synthetic "ib" handle so the per-protocol branches below stay close
    // to the previous shape (less churn in the giant switch).
    const ib = {
      id: b.id,
      protocol: b.profile.protocol,
      profileId: b.profile.id,
      config: cfgMerged,
    };

    // Slice 30: fan-out per host. A binding with no ENABLED host serves
    // nothing, full stop.
    //
    // This used to fall back to `[null]` so a binding skipped by the backfill
    // migration would not silently drop out of the subscription. That guard
    // outlived its data and became a bug the moment hosts got a delete button:
    // the query filters on `enabled: true`, so removing the last host, or
    // merely switching it off, left the binding with zero rows and the
    // fallback handed the client a nameless endpoint labelled with the NODE
    // name. Seen in the field 2026-07-30: a deleted host reappeared in Happ as
    // "nl2". The panel meanwhile says, under the toggle, "Off hides it from
    // every subscription", which the fallback made untrue.
    //
    // Zero hosts is now a state an operator can deliberately reach, so it
    // means what it says.
    for (const hostRow of b.hosts) {
      const baseHost = b.publicHost ?? hostFromAddress(b.node.address);
      const basePort = b.publicPort ?? b.port;

      // Per-host overrides win over binding/profile values. NULL fields on
      // the host row preserve the underlying value.
      const host = hostRow?.addressOverride ?? baseHost;
      const port = hostRow?.portOverride ?? basePort;
      const hostRemark = hostRow?.remark ?? '';
      // The line a user reads in their client. A named host wins outright and
      // the flag leads; see subscriptionServerName. Until 2026-07-30 this was
      // `${node} · ${host}`, which put an internal node name in front of the
      // label the operator wrote, and carried no flag at all even though the
      // panel's own preview showed one.
      const nodeName = subscriptionServerName({
        hostRemark,
        nodeName: b.node.name,
        countryCode: b.node.countryCode,
      });
      const hostOverrides = hostRow ?? null;

    // Slice 30: common per-host metadata threaded onto each endpoint so
    // formatters can filter (`disableForFormats`) and richer URI builders
    // (slice 30.1) can emit alpn / allowInsecure / securityLayer without
    // re-fetching the host row.
    const securityLayerRaw = hostOverrides?.securityLayer ?? 'default';
    const securityLayer: 'default' | 'tls' | 'none' =
      securityLayerRaw === 'tls' || securityLayerRaw === 'none'
        ? securityLayerRaw
        : 'default';
    const hostMeta = {
      // Rides in `hostMeta` rather than being written out at each of the ten
      // pushes below: it is the same for every endpoint of this binding, and
      // one spread cannot be forgotten in a branch the way ten copies can.
      nodeId: b.node.id,
      hostId: hostOverrides?.id,
      // Identity, as opposed to the label above: the row this endpoint is
      // emitted from, which no rename can move. See endpoint-identity.ts.
      key: hostOverrides?.id ?? b.id,
      // Only carried when this binding has MORE THAN ONE host. It exists to
      // tell apart the several cascade profiles a multi-host entry produces,
      // which are otherwise identical strings. With a single host there is
      // nothing to disambiguate, and appending it just glued our internal host
      // name onto every way out ("balancer · SE · ru-01-xhttp-reality").
      hostRemark: b.hosts.length > 1 ? hostOverrides?.remark : undefined,
      alpn: hostOverrides?.alpn,
      allowInsecure: hostOverrides?.allowInsecure ?? false,
      securityLayer,
      disableForFormats: hostOverrides?.disableForFormats ?? [],
    };

    if (ib.protocol === 'hysteria') {
      const hyCfg = ib.config as
        | {
            obfsPassword?: string;
            brutalUpMbps?: number;
            brutalDownMbps?: number;
            portHoppingStart?: number;
            portHoppingEnd?: number;
          }
        | null;
      endpoints.push({
        protocol: 'hysteria',
        nodeName,
        host,
        port,
        ...hostMeta,
        password: user.hysteriaPassword,
        obfsPassword: hyCfg?.obfsPassword,
        upMbps: hyCfg?.brutalUpMbps,
        downMbps: hyCfg?.brutalDownMbps,
        portHoppingStart: hyCfg?.portHoppingStart,
        portHoppingEnd: hyCfg?.portHoppingEnd,
        uri: buildHysteriaUri({
          password: user.hysteriaPassword,
          host,
          port,
          name: nodeName,
          obfsPassword: hyCfg?.obfsPassword,
          upMbps: hyCfg?.brutalUpMbps,
          downMbps: hyCfg?.brutalDownMbps,
          portHoppingStart: hyCfg?.portHoppingStart,
          portHoppingEnd: hyCfg?.portHoppingEnd,
        }),
      });
    } else if (ib.protocol === 'xray' && user.xrayUuid) {
      const cfg = ib.config as unknown as XrayInboundConfig & {
        subprotocol?: 'vless' | 'trojan' | 'vmess';
        security?: 'reality' | 'none' | 'tls';
        tlsServerName?: string;
      };
      // Slice 30: per-host overrides on the most-used REALITY knobs. Each
      // null falls through to the profile-level config, so back-compat with
      // bindings that have only the auto-generated Default host stays exact.
      // For tls the SNI comes from the cert's serverName, not REALITY serverNames.
      // B3/G - REALITY self-steal: the SNI must be the NODE's own domain (the same
      // value the panel pushes as serverNames into the node config), so SNI and IP
      // stay consistent and survive RU-DPI. A host sniOverride still wins if set.
      const isSelfSteal = (cfg as { realityMode?: string }).realityMode === 'self-steal';
      const sni =
        hostOverrides?.sniOverride ??
        (isSelfSteal
          ? (b.node.domain ?? '')
          : cfg.security === 'tls'
            ? cfg.tlsServerName
            : cfg.realityServerNames[0]) ??
        '';
      const shortId = cfg.realityShortIds[0] ?? '';
      const network = cfg.network ?? 'raw';
      const subprotocol = cfg.subprotocol ?? 'vless';
      const fingerprint =
        hostOverrides?.fingerprintOverride ?? cfg.fingerprint;
      const xrayPath = hostOverrides?.pathOverride ?? cfg.path;
      const xrayHostHeader = hostOverrides?.hostHeaderOverride ?? cfg.host;
      // Slice 24c part 3: branch URI scheme on subprotocol. We reuse
      // user.xrayUuid as the Trojan password (UUIDs have plenty of entropy
      // and admins are already managing them; a separate trojanPassword
      // column would be redundant credential management).
      // Slice 30.1: per-host overrides emitted into URI. Empty alpn array
      // falls through (URI builder skips the param), so back-compat is exact.
      const hostAlpn = hostMeta.alpn;
      const hostAllowInsecure = hostMeta.allowInsecure;
      // Base security comes from the profile: 'none' (a CDN-fronted / plain
      // inbound, rendered as security:"none" on the node) maps to a 'none'
      // client-URI layer; otherwise reality. A per-host override (tls/none)
      // still wins over the profile base.
      const profileSecurity = cfg.security ?? 'reality';
      const effectiveSecurityLayer: 'default' | 'tls' | 'none' =
        hostMeta.securityLayer === 'tls' || hostMeta.securityLayer === 'none'
          ? hostMeta.securityLayer
          : profileSecurity === 'none'
            ? 'none'
            : profileSecurity === 'tls'
              ? 'tls'
              : 'default';
      let uri: string;
      if (subprotocol === 'trojan') {
        uri = buildTrojanRealityUri({
          password: user.xrayUuid,
          host,
          port,
          publicKey: cfg.realityPublicKey,
          shortId,
          sni,
          fingerprint,
          network,
          path: xrayPath,
          hostHeader: xrayHostHeader,
          serviceName: cfg.serviceName,
          name: nodeName,
          alpn: hostAlpn,
          allowInsecure: hostAllowInsecure,
          securityLayer: effectiveSecurityLayer,
        });
      } else if (subprotocol === 'vmess') {
        // VMess share link carries no REALITY: security is none (CDN-fronted /
        // plain) or tls only. 'default' (reality) collapses to 'none' here.
        uri = buildVmessUri({
          uuid: user.xrayUuid,
          host,
          port,
          name: nodeName,
          network,
          path: xrayPath,
          hostHeader: xrayHostHeader,
          serviceName: cfg.serviceName,
          sni,
          fingerprint,
          alpn: hostAlpn,
          securityLayer: effectiveSecurityLayer === 'tls' ? 'tls' : 'none',
        });
      } else {
        uri = buildVlessRealityUri({
          uuid: user.xrayUuid,
          host,
          port,
          publicKey: cfg.realityPublicKey,
          shortId,
          sni,
          flow: cfg.flow,
          fingerprint,
          network,
          path: xrayPath,
          hostHeader: xrayHostHeader,
          serviceName: cfg.serviceName,
          name: nodeName,
          alpn: hostAlpn,
          allowInsecure: hostAllowInsecure,
          securityLayer: effectiveSecurityLayer,
        });
      }
      endpoints.push({
        protocol: 'xray',
        nodeName,
        host,
        port,
        ...hostMeta,
        securityLayer: effectiveSecurityLayer,
        uuid: user.xrayUuid,
        publicKey: cfg.realityPublicKey,
        shortId,
        sni,
        flow: cfg.flow,
        fingerprint,
        network,
        path: xrayPath,
        hostHeader: xrayHostHeader,
        serviceName: cfg.serviceName,
        subprotocol,
        uri,
        // A4: set only when this node is a balancer-cascade entry. Undefined
        // otherwise, so the array format emits a single config as before.
        cascadeExits: balancerExits.get(b.node.id),
      });
    } else if (ib.protocol === 'amneziawg' && user.amneziawgPrivateKey) {
      const cfg = ib.config as unknown as AmneziawgInboundConfig;
      // Slice 27: peer is keyed on profileId (one allocation per logical
      // AmneziaWG profile, shared across all nodes the profile is bound to).
      const peer = await allocatePeer(ib.profileId, user.id, cfg.subnet);
      endpoints.push({
        protocol: 'amneziawg',
        nodeName,
        host,
        port,
        ...hostMeta,
        privateKey: user.amneziawgPrivateKey,
        allowedIp: `${peer.ip}/32`,
        serverPublicKey: cfg.serverPublicKey,
        jc: cfg.obfuscation.jc,
        jmin: cfg.obfuscation.jmin,
        jmax: cfg.obfuscation.jmax,
        s1: cfg.obfuscation.s1,
        s2: cfg.obfuscation.s2,
        s3: cfg.obfuscation.s3,
        s4: cfg.obfuscation.s4,
        h1: cfg.obfuscation.h1,
        h2: cfg.obfuscation.h2,
        h3: cfg.obfuscation.h3,
        h4: cfg.obfuscation.h4,
        i1: cfg.obfuscation.i1 ?? '',
        i2: cfg.obfuscation.i2 ?? '',
        i3: cfg.obfuscation.i3 ?? '',
        i4: cfg.obfuscation.i4 ?? '',
        i5: cfg.obfuscation.i5 ?? '',
        // No standardised URI format for AmneziaWG; clients fetch ?format=wgconf.
        uri: '',
      });
    } else if (ib.protocol === 'mtproto') {
      // Slice 41: Telegram MTProto via 9seconds/mtg. Architectural note:
      // mtg is intentionally single-secret upstream. So every user
      // assigned to this inbound's squad receives the SAME secret + URL.
      // We derive once per inbound from (inboundId, domain). Domain
      // change rotates the secret. No per-user accounting available.
      const cfg = ib.config as unknown as { domain: string };
      const secret = mtprotoSecret(ib.id, cfg.domain);
      endpoints.push({
        protocol: 'mtproto',
        nodeName,
        host,
        port,
        ...hostMeta,
        secret,
        domain: cfg.domain,
        uri: buildMtprotoUri({ secret, host, port, name: nodeName }),
        tmeUri: buildMtprotoTmeUri({ secret, host, port }),
      });
    } else if (ib.protocol === 'mieru' && user.xrayUuid) {
      // Slice 40: Mieru. Username = panel username for log-readability;
      // password = xrayUuid (no extra credential surface).
      const cfg = ib.config as unknown as { mtu: number };
      endpoints.push({
        protocol: 'mieru',
        nodeName,
        host,
        port,
        ...hostMeta,
        username: user.username,
        password: user.xrayUuid,
        mtu: cfg.mtu,
        uri: buildMieruUri({
          username: user.username,
          password: user.xrayUuid,
          host,
          port,
          mtu: cfg.mtu,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'shadowsocks' && user.xrayUuid) {
      const ssCfg = ib.config as unknown as {
        method: ShadowsocksMethod;
        serverPsk?: string;
      };
      // SS2022 multi-user: the per-user uPSK is DERIVED from xrayUuid - a raw
      // UUID is not a valid base64 key, and the node derives the identical value
      // (core.DeriveSsPassword). The client credential is ServerPSK:UserPSK
      // colon-joined; the clash/sing-box/outline formats read endpoint.password
      // directly, so set the combined value there and hand the parts to the URI
      // builder (which joins them).
      const ssUserPsk = deriveSsPassword(user.xrayUuid, ssCfg.method);
      const ssClientPassword = ssCfg.serverPsk
        ? `${ssCfg.serverPsk}:${ssUserPsk}`
        : ssUserPsk;
      endpoints.push({
        protocol: 'shadowsocks',
        nodeName,
        host,
        port,
        ...hostMeta,
        method: ssCfg.method,
        password: ssClientPassword,
        uri: buildShadowsocksUri({
          method: ssCfg.method,
          userPsk: ssUserPsk,
          serverPsk: ssCfg.serverPsk,
          host,
          port,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'naive' && user.naivePassword) {
      const cfg = ib.config as unknown as NaiveInboundConfig;
      // Public host for naive defaults to the inbound's TLS hostname rather
      // than node.address, because Caddy answers ACME on `cfg.hostname`.
      //
      // A host's addressOverride still wins over it. Until 2026-07-29 the
      // profile value came first, which inverted the whole override model: the
      // operator set an address on the host, the form reported it as active,
      // and the subscription quietly emitted the profile's hostname instead.
      // Every other protocol resolves address overrides before the protocol
      // switch (`host` above), naive was the one exception.
      const naiveHost = hostOverrides?.addressOverride ?? (cfg.hostname || host);
      endpoints.push({
        protocol: 'naive',
        nodeName,
        host: naiveHost,
        port,
        ...hostMeta,
        username: user.username,
        password: user.naivePassword,
        uri: buildNaiveUri({
          username: user.username,
          password: user.naivePassword,
          host: naiveHost,
          port,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'tuic' && user.xrayUuid) {
      // TUIC v5 (sing-box engine). uuid = user.xrayUuid; password derived from
      // it (deriveTuicPassword) - same value the node receives, no extra
      // credential surface. Node serves a self-signed cert in the alpha, so the
      // URI sets allow_insecure (client trusts it + the matching SNI).
      const cfg = ib.config as unknown as { serverName?: string; congestionControl?: string };
      const tuicSni = cfg.serverName || 'www.bing.com';
      const tuicCc = cfg.congestionControl || 'bbr';
      const tuicPassword = deriveTuicPassword(user.xrayUuid);
      endpoints.push({
        protocol: 'tuic',
        nodeName,
        host,
        port,
        ...hostMeta,
        uuid: user.xrayUuid,
        password: tuicPassword,
        serverName: tuicSni,
        congestionControl: tuicCc,
        uri: buildTuicUri({
          uuid: user.xrayUuid,
          password: tuicPassword,
          host,
          port,
          serverName: tuicSni,
          congestionControl: tuicCc,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'anytls' && user.xrayUuid) {
      // AnyTLS (sing-box engine). password-only; derived from xrayUuid (no extra
      // credential surface). Self-signed cert in the alpha -> client uses
      // allow-insecure + the matching SNI.
      const cfg = ib.config as unknown as { serverName?: string };
      const anytlsSni = cfg.serverName || 'www.bing.com';
      const anytlsPassword = deriveAnytlsPassword(user.xrayUuid);
      endpoints.push({
        protocol: 'anytls',
        nodeName,
        host,
        port,
        ...hostMeta,
        password: anytlsPassword,
        serverName: anytlsSni,
        uri: buildAnytlsUri({
          password: anytlsPassword,
          host,
          port,
          serverName: anytlsSni,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'shadowtls' && user.xrayUuid) {
      // ShadowTLS v3 (sing-box engine). Per-user shadowtls password derived from
      // xrayUuid; the inner ss key (ssPassword) is server-wide, from the config.
      // ShadowTLS has NO share-link -> uri:'' (encodePlainList drops it; emitted
      // only in the sing-box / clash full-config formats).
      const cfg = ib.config as unknown as {
        handshake?: string;
        ssMethod?: string;
        ssPassword?: string;
      };
      endpoints.push({
        protocol: 'shadowtls',
        nodeName,
        host,
        port,
        ...hostMeta,
        shadowtlsPassword: deriveShadowtlsPassword(user.xrayUuid),
        handshake: cfg.handshake || 'www.microsoft.com',
        ssMethod: cfg.ssMethod || '2022-blake3-aes-128-gcm',
        ssPassword: cfg.ssPassword || '',
        uri: '',
      });
    }
    } // host-row loop
  }

  try {
    await prisma.subscriptionRequestHistory.create({
      data: {
        userId: user.id,
        requestIp: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  } catch {
    // Audit failure must not block the subscription response.
  }

  // Two ways in that read the same are two rows a subscriber cannot choose
  // between, and in sing-box and Clash the row's name is also the identifier the
  // selector group points at. Bug #7 numbered such rows ("X", "X 2"); this names
  // what differs instead, and carries the result into the link's own remark,
  // which the numbering never did.
  disambiguateEndpointLabels(endpoints);

  // One line per cascade profile, dealt across the pool's entries. Runs AFTER
  // the labels above, and has to: it identifies an entry by a string that
  // includes the label, so two entries still reading alike would land in one
  // slot, the deal would filter the last of them and leave the other holding
  // every line - twice the rows, which is the thing this call exists to remove.
  // The price of that order is cosmetic: an entry can keep a "· XHTTP" it
  // earned against a sibling the collapse then drops.
  collapseCascadeLines(endpoints, user.id);

  // Same idea one level down: whatever cascade lines remain must still be
  // distinguishable from each other, and from any non-cascade endpoint.
  disambiguateCascadeLabels(endpoints);

  // R3-a - resolve the per-squad routing override across the user's squads,
  // reusing the memberships already loaded above (no extra query).
  const squadRoutingPreset = resolveSquadRouting(
    memberships.map((m) => m.group.routingPreset),
  );

  return {
    endpoints,
    textPlain: encodePlainList(endpoints.flatMap((e) => expandEndpointUris(e))),
    json: buildSubscriptionJson(user, endpoints),
    squadRoutingPreset,
    // R3 - per-user override (scalar already loaded on `user`). Garbage / unset
    // values fall through to null so the route's chain drops to the next tier.
    userRoutingPreset: isRoutingPresetId(user.routingPreset) ? user.routingPreset : null,
  };
}
