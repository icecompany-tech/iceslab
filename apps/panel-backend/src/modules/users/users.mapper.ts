import type { GroupMember, User, UserTraffic } from '../../generated/prisma/client.js';

/**
 * A traffic row, optionally with the node it points at already loaded.
 *
 * Optional rather than required so a caller that has no use for the name (an
 * update returning one user, say) is not forced to join. When it is absent the
 * DTO says null, which is the same thing the column says for a user who has
 * never connected, and the id next to it tells the two apart.
 */
export type TrafficWithNode = UserTraffic & {
  lastConnectedNode?: { id: string; name: string } | null;
};

/**
 * Public DTO returned to admins via REST API.
 * Strips all protocol credentials and internal lifecycle fields.
 */
export interface PublicUserDto {
  id: string;
  shortId: string;
  username: string;
  status: string;

  // Subscription window
  expireAt: string | null;          // ISO 8601 string

  // Traffic
  trafficLimitBytes: number | null;     // null = unlimited
  trafficUsedBytes: number;
  lifetimeTrafficBytes: number;
  trafficLimitStrategy: string;
  lastTrafficResetAt: string | null;
  /** When the user last connected (touched any node). null = never online. */
  lastOnlineAt: string | null;
  /** First time this user was ever seen on any node. null = never connected.
   *  Written once, on the insert of their traffic row (stats.cron), so it
   *  survives every later tick and answers "since when are they a subscriber"
   *  independently of createdAt, which only says when the row was made. */
  firstConnectedAt: string | null;
  /** Node the user was last seen on. null = never connected, or the node was
   *  deleted (the FK is SetNull). */
  lastConnectedNodeId: string | null;
  /** Name of that node, carried alongside the id so a roster of 500 rows does
   *  not become 500 lookups: the id alone is unreadable in a table cell, and
   *  resolving it client-side would mean a second request per page. Null
   *  whenever the id is, and also when the caller did not ask for the relation. */
  lastConnectedNodeName: string | null;

  // Subscription URL
  subscriptionToken: string;
  subRevokedAt: string | null;

  // Limits
  hwidDeviceLimit: number | null;

  // R3 - per-user routing-preset override; null = inherit (squad -> global -> default).
  routingPreset: string | null;

  // Metadata
  description: string | null;
  tag: string | null;
  telegramId: string | null;        // BigInt → string
  email: string | null;

  // Per-user enabled protocols (subset of {hysteria,xray,amneziawg,naive})
  enabledProtocols: string[];

  // Squad membership (slice 26)
  groupIds: string[];

  // Lifecycle
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert Prisma User (+ optional UserTraffic) into the public-safe DTO.
 *
 * Rules:
 *   - Never include: hysteriaPassword, naivePassword, xrayUuid,
 *     amneziawgPrivateKey, amneziawgPublicKey, deletedAt
 *   - BigInt → number (safe up to 9 PB, our quotas are way below)
 *   - BigInt telegramId → string (full precision preserved)
 *   - Date → ISO string
 */
export function mapUserToPublic(
  user: User & { groupMembers?: Pick<GroupMember, 'groupId'>[] },
  traffic: TrafficWithNode | null,
): PublicUserDto {
  return {
    id: user.id,
    shortId: user.shortId,
    username: user.username,
    status: user.status,

    expireAt: user.expireAt ? user.expireAt.toISOString() : null,

    trafficLimitBytes: user.trafficLimitBytes !== null
      ? Number(user.trafficLimitBytes)
      : null,
    trafficUsedBytes: traffic ? Number(traffic.usedTrafficBytes) : 0,
    lifetimeTrafficBytes: traffic ? Number(traffic.lifetimeTrafficBytes) : 0,
    trafficLimitStrategy: user.trafficLimitStrategy,
    lastTrafficResetAt: traffic?.lastTrafficResetAt
      ? traffic.lastTrafficResetAt.toISOString()
      : null,
    lastOnlineAt: traffic?.onlineAt ? traffic.onlineAt.toISOString() : null,
    firstConnectedAt: traffic?.firstConnectedAt
      ? traffic.firstConnectedAt.toISOString()
      : null,
    lastConnectedNodeId: traffic?.lastConnectedNodeId ?? null,
    lastConnectedNodeName: traffic?.lastConnectedNode?.name ?? null,

    subscriptionToken: user.subscriptionToken,
    subRevokedAt: user.subRevokedAt ? user.subRevokedAt.toISOString() : null,

    hwidDeviceLimit: user.hwidDeviceLimit,

    routingPreset: user.routingPreset,

    description: user.description,
    tag: user.tag,
    telegramId: user.telegramId !== null ? user.telegramId.toString() : null,
    email: user.email,

    enabledProtocols: parseEnabledProtocols(user.enabledProtocols),

    groupIds: user.groupMembers?.map((m) => m.groupId) ?? [],

    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * Prisma `Json` field returns `unknown`, narrow to a string[] of valid
 * protocol names. Falls back to ['hysteria'] if the stored shape is
 * unexpected (defensive, should not happen with our schema validation).
 */
export function parseEnabledProtocols(value: unknown): string[] {
  if (!Array.isArray(value)) return ['hysteria'];
  return value.filter((v): v is string => typeof v === 'string');
}