import { redis } from '../../lib/infra/redis.js';

/**
 * A-038: a signed-out session ends on the server, not only in the browser.
 *
 * By jti, one key per token, rather than a session version on the admin row:
 * a version would end every session of the admin at once (sign out here means
 * sign out everywhere, which the button does not say), and it needs a
 * migration. The key lives until the token's own exp and then goes, so the
 * list is never longer than the tokens still alive.
 *
 * A-039: a password change ends every session of the admin at once, the
 * current one too, by one key per admin: tokens issued up to that moment are
 * refused. It lives as long as a token does, after which every token it could
 * refuse has expired by itself.
 */
const revokedKey = (jti: string) => `auth:revoked:${jti}`;
const endedKey = (adminId: string) => `auth:sessions-ended:${adminId}`;

/**
 * How long the check waits for Redis. The client queues commands while it
 * reconnects and never gives up on them (maxRetriesPerRequest: null, which
 * BullMQ needs), so without this a request would hang for as long as Redis
 * is away instead of being refused.
 */
const CHECK_TIMEOUT_MS = 2000;

/** Remember the token as signed out until it would have expired anyway. */
export async function revokeToken(jti: string, exp: number, now = Date.now()): Promise<void> {
  const ttl = exp - Math.floor(now / 1000);
  if (ttl <= 0) return;
  await redis.set(revokedKey(jti), '1', 'EX', ttl);
}

/** End every session of the admin issued up to `atMs`, for `ttlSeconds`. */
export async function endSessionsBefore(adminId: string, atMs: number, ttlSeconds: number): Promise<void> {
  await redis.set(endedKey(adminId), String(atMs), 'EX', Math.max(1, ttlSeconds));
}

export type SessionState = 'live' | 'signed-out' | 'ended';

/**
 * One read for both: the token signed out by its id, or issued before the
 * admin's sessions were ended. Throws when Redis does not answer within
 * CHECK_TIMEOUT_MS; the caller decides what that means.
 */
export async function sessionState(jti: string, adminId: string, issuedMs: number): Promise<SessionState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('session check timed out')), CHECK_TIMEOUT_MS);
  });
  try {
    const [revoked, endedAt] = await Promise.race([redis.mget(revokedKey(jti), endedKey(adminId)), timeout]);
    if (revoked !== null) return 'signed-out';
    if (endedAt !== null && issuedMs <= Number(endedAt)) return 'ended';
    return 'live';
  } finally {
    clearTimeout(timer);
  }
}
