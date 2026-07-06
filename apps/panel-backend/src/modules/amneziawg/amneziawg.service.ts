import type { AmneziawgPeer } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { intToIp, ipToInt, parseSubnet } from './amneziawg.subnet.js';
import { Prisma } from '../../generated/prisma/client.js';

// Default AmneziaWG subnet. Picked far from typical hosting-provider
// infrastructure ranges, some budget VPS providers put their host gateway
// on 10.0.0.1, so an AWG server tunnel-IP of 10.0.0.1/24 collides with the
// host's default route and the VPS loses connectivity minutes after the
// interface comes up (caught live cycle #6 2026-05-12). 10.66.66.0/24 is
// uncommon enough to avoid most cloud-provider clashes; admins can still
// override per-profile via the UI.
export const DEFAULT_SUBNET = '10.66.66.0/24';

export class IpExhaustedError extends Error {
  constructor(
    public readonly profileId: string,
    public readonly subnet: string,
  ) {
    super(`No free IPs left in ${subnet} for profile ${profileId}`);
    this.name = 'IpExhaustedError';
  }
}

export async function getPeer(
  profileId: string,
  userId: string,
): Promise<AmneziawgPeer | null> {
  return prisma.amneziawgPeer.findUnique({
    where: { profileId_userId: { profileId, userId } },
  });
}

export async function listPeers(profileId: string): Promise<AmneziawgPeer[]> {
  const rows = await prisma.amneziawgPeer.findMany({ where: { profileId } });
  return rows.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
}

/**
 * Allocate a stable IP for (profile, user). Idempotent, returns the existing
 * row if one is already there. Picks the lowest unused address inside the
 * subnet (skipping network, server, and broadcast).
 *
 * Slice 27: keyed on profile (the logical AmneziaWG inbound) instead of the
 * old per-node inbound. Same user gets the same IP across every node a profile
 * is bound to; separate WG processes per node never see each other so this is
 * safe.
 *
 * Race-safe via the UNIQUE(profile_id, ip) constraint: a concurrent allocator
 * that grabs our chosen IP triggers a P2002, we re-scan and try the next free
 * slot. A concurrent allocator for the same user collapses to the existing row
 * via UNIQUE(profile_id, user_id).
 */
/**
 * Wave-14 #14: single round-trip allocation via SQL window query.
 * Pre-wave each call was 3 queries (SELECT existing, SELECT all peers,
 * INSERT) and the in-memory loop scanned up to /24 = 254 candidates in
 * JS. Now one CTE does idempotent-fetch + first-free-scan + insert. Index
 * on (profile_id, ip) makes each NOT EXISTS lookup an index probe.
 *
 * Race semantics preserved: ON CONFLICT (profile_id, ip) DO NOTHING means
 * a concurrent allocator that grabbed our chosen IP between scan and
 * insert returns empty, the outer 5-attempt loop retries. UNIQUE on
 * (profile_id, user_id) means a concurrent allocator for the SAME user
 * collapses to the existing row via the UNION ALL branch.
 */
export async function allocatePeer(
  profileId: string,
  userId: string,
  subnet: string = DEFAULT_SUBNET,
): Promise<AmneziawgPeer> {
  const range = parseSubnet(subnet);
  const firstIp = intToIp(range.firstUsable);
  const lastIp = intToIp(range.lastUsable);
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rows = await prisma.$queryRaw<
      { id: string; profile_id: string; user_id: string; ip: string; created_at: Date }[]
    >(Prisma.sql`
      WITH
        existing AS (
          SELECT id, profile_id, user_id, ip, created_at
          FROM amneziawg_peers
          WHERE profile_id = ${profileId}::uuid AND user_id = ${userId}::uuid
        ),
        free AS (
          -- Bug #6: bound the candidate scan to the peer count, not the whole
          -- subnet. By pigeonhole the lowest free IP is always at index
          -- <= count(peers) (N taken IPs cannot fill N+1 consecutive slots),
          -- so scanning [0 .. LEAST(subnet_size, peer_count)] always finds the
          -- lowest free address. This makes a /16 or /8 cost O(peers) instead
          -- of materializing 65k / 16.7M generate_series rows per call.
          SELECT host((${firstIp}::inet) + gs) AS ip
          FROM generate_series(
            0,
            LEAST(
              (${lastIp}::inet - ${firstIp}::inet)::int,
              (SELECT count(*)::int FROM amneziawg_peers WHERE profile_id = ${profileId}::uuid)
            )
          ) AS gs
          WHERE NOT EXISTS (
            SELECT 1 FROM amneziawg_peers ap
            WHERE ap.profile_id = ${profileId}::uuid
              AND ap.ip = host((${firstIp}::inet) + gs)
          )
          AND NOT EXISTS (SELECT 1 FROM existing)
          ORDER BY gs
          LIMIT 1
        ),
        inserted AS (
          INSERT INTO amneziawg_peers (id, profile_id, user_id, ip, created_at)
          SELECT gen_random_uuid(), ${profileId}::uuid, ${userId}::uuid, free.ip, NOW()
          FROM free
          ON CONFLICT (profile_id, ip) DO NOTHING
          RETURNING id, profile_id, user_id, ip, created_at
        )
      SELECT * FROM inserted
      UNION ALL
      SELECT * FROM existing
      LIMIT 1;
    `);

    if (rows.length > 0) {
      const r = rows[0]!;
      return {
        id: r.id,
        profileId: r.profile_id,
        userId: r.user_id,
        ip: r.ip,
        createdAt: r.created_at,
      };
    }

    // Empty result = either IP-range exhausted or we lost a race on the
    // chosen IP. Distinguish by checking subnet capacity vs. taken count.
    const taken = await prisma.amneziawgPeer.count({ where: { profileId } });
    const capacity = range.lastUsable - range.firstUsable + 1;
    if (taken >= capacity) throw new IpExhaustedError(profileId, subnet);
    // Otherwise it was a race, retry. (ipToInt unused on this path but
    // kept imported for tests / other call sites.)
    void ipToInt;
  }
  throw new Error(
    `Failed to allocate amneziawg peer for profile ${profileId} after ${maxAttempts} attempts`,
  );
}

export async function releasePeer(
  profileId: string,
  userId: string,
): Promise<void> {
  await prisma.amneziawgPeer.deleteMany({ where: { profileId, userId } });
}

/**
 * B7 - bulk-allocate AmneziaWG IPs for many users in one statement instead of
 * N serial allocatePeer round-trips (a 1000-user node push used to do ~1000
 * sequential queries before fanning out addUser). Assigns the lowest free IPs
 * to users that don't yet have a peer on this profile.
 *
 * Same pigeonhole reasoning as allocatePeer: the N lowest free IPs all fall
 * within the first `existing + needed` addresses (only `existing` are taken),
 * so the candidate scan stays O(peers) rather than materialising the whole
 * subnet. `ON CONFLICT DO NOTHING` (untargeted - covers both the (profile,ip)
 * and (profile,user) unique constraints) makes it race-safe: a row that lost a
 * race is simply skipped, and the caller falls back to allocatePeer() for any
 * user still missing in the returned map.
 *
 * Returns the full userId -> ip map for the requested users (pre-existing peers
 * plus freshly inserted ones). Users absent from the map either lost a race or
 * the subnet is exhausted - the caller decides how to handle them.
 */
export async function preallocatePeers(
  profileId: string,
  userIds: string[],
  subnet: string = DEFAULT_SUBNET,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;

  const range = parseSubnet(subnet);
  const firstIp = intToIp(range.firstUsable);
  const lastIp = intToIp(range.lastUsable);

  await prisma.$executeRaw(Prisma.sql`
    WITH
      needed AS (
        SELECT u.id AS user_id, row_number() OVER (ORDER BY u.id) AS rn
        FROM unnest(ARRAY[${Prisma.join(userIds)}]::uuid[]) AS u(id)
        WHERE NOT EXISTS (
          SELECT 1 FROM amneziawg_peers p
          WHERE p.profile_id = ${profileId}::uuid AND p.user_id = u.id
        )
      ),
      cnt AS (SELECT count(*)::int AS n FROM needed),
      free AS (
        SELECT host((${firstIp}::inet) + gs) AS ip,
               row_number() OVER (ORDER BY gs) AS rn
        FROM generate_series(
          0,
          LEAST(
            (${lastIp}::inet - ${firstIp}::inet)::int,
            (SELECT count(*)::int FROM amneziawg_peers WHERE profile_id = ${profileId}::uuid)
              + (SELECT n FROM cnt)
          )
        ) AS gs
        WHERE NOT EXISTS (
          SELECT 1 FROM amneziawg_peers p
          WHERE p.profile_id = ${profileId}::uuid
            AND p.ip = host((${firstIp}::inet) + gs)
        )
        ORDER BY gs
        LIMIT (SELECT n FROM cnt)
      )
    INSERT INTO amneziawg_peers (id, profile_id, user_id, ip, created_at)
    SELECT gen_random_uuid(), ${profileId}::uuid, n.user_id, f.ip, NOW()
    FROM needed n JOIN free f ON n.rn = f.rn
    ON CONFLICT DO NOTHING
  `);

  const rows = await prisma.amneziawgPeer.findMany({
    where: { profileId, userId: { in: userIds } },
    select: { userId: true, ip: true },
  });
  for (const r of rows) result.set(r.userId, r.ip);
  return result;
}
