import type { AmneziawgPeer } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { intToIp, ipToInt, parseSubnet } from './amneziawg.subnet.js';
import { Prisma } from '../../generated/prisma/client.js';

// Default AmneziaWG subnet. Picked far from typical hosting-provider
// infrastructure ranges — Aeza's internal gateway sits on 10.0.0.1,
// so any AWG server tunnel-IP of 10.0.0.1/24 collides with the host's
// default route and the VPS loses connectivity minutes after the
// interface comes up (caught live cycle #6 2026-05-12 via Aeza support).
// 10.66.66.0/24 is uncommon enough to avoid most cloud-provider clashes;
// admins can still override per-profile via the UI.
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
 * Allocate a stable IP for (profile, user). Idempotent — returns the existing
 * row if one is already there. Picks the lowest unused address inside the
 * subnet (skipping network, server, and broadcast).
 *
 * Slice 27 — keyed on profile (the logical AmneziaWG inbound) instead of the
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
          SELECT host((${firstIp}::inet) + gs) AS ip
          FROM generate_series(0, (${lastIp}::inet - ${firstIp}::inet))::int AS gs
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
    // Otherwise it was a race — retry. (ipToInt unused on this path but
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
