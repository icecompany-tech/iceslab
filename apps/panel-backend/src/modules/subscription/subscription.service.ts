import { prisma } from '../../prisma.js';
import {
  lookupClientCountry,
  rankNodesForUser,
  type NodeForRanking,
} from './node-selection.js';
// Slice 27 follow-up: enabledProtocols is no longer consulted — squad ACL is
// the single source of truth for which protocols a user sees. The column is
// kept on the User row for backwards-compat but never filters subscription
// output.
import { allocatePeer } from '../amneziawg/amneziawg.service.js';
import { buildNaiveUri } from '../../core-adapters/naive/index.js';
import {
  buildHysteriaUri,
  buildMieruUri,
  buildMtprotoTmeUri,
  buildMtprotoUri,
  buildShadowsocksUri,
  buildSubscriptionJson,
  buildTrojanRealityUri,
  buildVlessRealityUri,
  encodePlainList,
  hostFromAddress,
  mtprotoSecret,
  type ShadowsocksMethod,
  type SubscriptionEndpoint,
  type SubscriptionJsonResponse,
} from './subscription.formats.js';

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

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  /** Slice 28 — when set, limit subscription to top-N nodes ranked by
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
}

// ───── Per-protocol config shapes (mirror inbounds.schemas.ts) ─────

interface XrayInboundConfig {
  realityDest: string;
  realityServerNames: string[];
  realityShortIds: string[];
  realityPrivateKey: string;
  realityPublicKey: string;
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
  /** I1-I5: v2.0 mimicry signature packets (hex). Optional — Zod
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

  // Slice 27 — Squad ACL is now profile-level. Visible bindings are the
  // UNION of bindings of every profile attached to a group the user is a
  // member of. If the user has zero memberships the subscription is empty
  // (createUser auto-adds them to "All", so this is only reachable if
  // someone clears memberships via raw SQL).
  const bindings = await prisma.profileNodeBinding.findMany({
    where: {
      enabled: true,
      profile: {
        enabled: true,
        groupProfiles: {
          some: {
            group: { members: { some: { userId: user.id } } },
          },
        },
      },
      node: { deletedAt: null, status: { not: 'disabled' } },
    },
    include: {
      profile: { select: { id: true, protocol: true, config: true } },
      node: {
        select: {
          id: true,
          name: true,
          address: true,
          createdAt: true,
          // Slice 28 — region.code drives the "same-region bonus" in the
          // smart-selection ranker. Null when admin hasn't tagged a region;
          // ranker still works (utilization-only score for that node).
          region: { select: { code: true } },
        },
      },
      // Slice 30 — one binding fans out into N enabled hosts. Order them
      // by `priority` so subscription URL ordering is admin-controlled.
      hosts: {
        where: { enabled: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: [{ port: 'asc' }],
  });
  // Sort by node createdAt then port so the order across formats stays stable.
  bindings.sort((a, b) => {
    const t = a.node.createdAt.getTime() - b.node.createdAt.getTime();
    return t !== 0 ? t : a.port - b.port;
  });

  // Slice 28 — smart node selection. When the route passed topN+cfCountry,
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

    // Slice 30 — fan-out per host. Backfill migration guarantees ≥1 host
    // per binding; ensureDefaultHost() does the same for new bindings.
    // The fallback below covers a migration-skipped binding so the
    // subscription never silently drops to zero URLs.
    const hostRows = b.hosts.length > 0 ? b.hosts : [null];
    for (const hostRow of hostRows) {
      const baseHost = b.publicHost ?? hostFromAddress(b.node.address);
      const basePort = b.publicPort ?? b.port;

      // Per-host overrides win over binding/profile values. NULL fields on
      // the host row preserve the underlying value.
      const host = hostRow?.addressOverride ?? baseHost;
      const port = hostRow?.portOverride ?? basePort;
      const hostRemark = hostRow?.remark ?? '';
      const nodeName = hostRemark && hostRemark !== 'Default'
        ? `${b.node.name} · ${hostRemark}`
        : b.node.name;
      const hostOverrides = hostRow ?? null;

    // Slice 30 — common per-host metadata threaded onto each endpoint so
    // formatters can filter (`disableForFormats`) and richer URI builders
    // (slice 30.1) can emit alpn / allowInsecure / securityLayer without
    // re-fetching the host row.
    const securityLayerRaw = hostOverrides?.securityLayer ?? 'default';
    const securityLayer: 'default' | 'tls' | 'none' =
      securityLayerRaw === 'tls' || securityLayerRaw === 'none'
        ? securityLayerRaw
        : 'default';
    const hostMeta = {
      hostId: hostOverrides?.id,
      hostRemark: hostOverrides?.remark,
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
        subprotocol?: 'vless' | 'trojan';
      };
      // Slice 30 — per-host overrides on the most-used REALITY knobs. Each
      // null falls through to the profile-level config, so back-compat with
      // bindings that have only the auto-generated Default host stays exact.
      const sni = hostOverrides?.sniOverride ?? cfg.realityServerNames[0] ?? '';
      const shortId = cfg.realityShortIds[0] ?? '';
      const network = cfg.network ?? 'raw';
      const subprotocol = cfg.subprotocol ?? 'vless';
      const fingerprint =
        hostOverrides?.fingerprintOverride ?? cfg.fingerprint;
      const xrayPath = hostOverrides?.pathOverride ?? cfg.path;
      const xrayHostHeader = hostOverrides?.hostHeaderOverride ?? cfg.host;
      // Slice 24c part 3 — branch URI scheme on subprotocol. We reuse
      // user.xrayUuid as the Trojan password (UUIDs have plenty of entropy
      // and admins are already managing them; a separate trojanPassword
      // column would be redundant credential management).
      // Slice 30.1 — per-host overrides emitted into URI. Empty alpn array
      // falls through (URI builder skips the param), so back-compat is exact.
      const hostAlpn = hostMeta.alpn;
      const hostAllowInsecure = hostMeta.allowInsecure;
      const hostSecurityLayer = hostMeta.securityLayer;
      const uri =
        subprotocol === 'trojan'
          ? buildTrojanRealityUri({
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
              securityLayer: hostSecurityLayer,
            })
          : buildVlessRealityUri({
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
              securityLayer: hostSecurityLayer,
            });
      endpoints.push({
        protocol: 'xray',
        nodeName,
        host,
        port,
        ...hostMeta,
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
      });
    } else if (ib.protocol === 'amneziawg' && user.amneziawgPrivateKey) {
      const cfg = ib.config as unknown as AmneziawgInboundConfig;
      // Slice 27 — peer is keyed on profileId (one allocation per logical
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
      // Slice 41 — Telegram MTProto via 9seconds/mtg. Architectural note:
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
      // Slice 40 — Mieru. Username = panel username for log-readability;
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
      // Slice 24d (fix 2026-05-07): SS2022 multi-user requires
      // ServerPSK:UserPSK colon-joined in the URI. Server PSK is per-
      // inbound, generated at create-time and stored in inbound.config.
      // Per-user PSK reuses user.xrayUuid (UUIDs have enough entropy;
      // growing users.shadowsocksPsk just for this protocol is overkill).
      endpoints.push({
        protocol: 'shadowsocks',
        nodeName,
        host,
        port,
        ...hostMeta,
        method: ssCfg.method,
        password: user.xrayUuid,
        uri: buildShadowsocksUri({
          method: ssCfg.method,
          userPsk: user.xrayUuid,
          serverPsk: ssCfg.serverPsk,
          host,
          port,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'naive' && user.naivePassword) {
      const cfg = ib.config as unknown as NaiveInboundConfig;
      // Public host for naive is the inbound's TLS hostname, not the panel's
      // node.address (Caddy answers ACME on `cfg.hostname`).
      const naiveHost = cfg.hostname || host;
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

  // Bug #7: all three structured formatters derive their outbound tag as
  // `${nodeName}-${protocol}` (sing-box tag, Clash name, xray-json tag). Two
  // hosts on the SAME binding (same node, same protocol) with empty/"Default"
  // remark collide on that tag, and Clash/sing-box/xray reject duplicate tags
  // -> broken client config. Disambiguate on the (nodeName, protocol) PAIR so
  // the same node under two different protocols keeps its name (the tags
  // already differ); only a real same-name+same-protocol collision is renamed
  // ("X", "X 2", ...). First occurrence keeps the original name.
  const usedTags = new Set<string>();
  for (const e of endpoints) {
    let name = e.nodeName;
    let n = 2;
    while (usedTags.has(`${name}-${e.protocol}`)) {
      name = `${e.nodeName} ${n++}`;
    }
    usedTags.add(`${name}-${e.protocol}`);
    e.nodeName = name;
  }

  return {
    endpoints,
    textPlain: encodePlainList(endpoints.map((e) => e.uri)),
    json: buildSubscriptionJson(user, endpoints),
  };
}
