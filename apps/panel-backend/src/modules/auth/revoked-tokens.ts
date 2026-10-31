import { redis } from '../../lib/infra/redis.js';

/**
 * A-038: a signed-out session ends on the server, not only in the browser.
 *
 * By jti, one key per token, rather than a session version on the admin row:
 * a version would end every session of the admin at once (sign out here means
 * sign out everywhere, which the button does not say), and it needs a
 * migration. The key lives until the token's own exp and then goes, so the
 * list is never longer than the tokens still alive.
 */
const keyOf = (jti: string) => `auth:revoked:${jti}`;

/** Remember the token as signed out until it would have expired anyway. */
export async function revokeToken(jti: string, exp: number, now = Date.now()): Promise<void> {
  const ttl = exp - Math.floor(now / 1000);
  if (ttl <= 0) return;
  await redis.set(keyOf(jti), '1', 'EX', ttl);
}

/** Throws when Redis does not answer; the caller decides what that means. */
export async function isRevoked(jti: string): Promise<boolean> {
  return (await redis.exists(keyOf(jti))) === 1;
}
