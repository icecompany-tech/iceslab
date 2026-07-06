import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless HMAC token used by the heartbeat-self-destruct loop.
 *
 * Format: `<nodeId>.<base64url(hmac_sha256(nodeId, heartbeatSecret))>`
 *
 * The agent presents this as `Authorization: Bearer <token>` on every
 * GET /api/internal/nodes/me/status. Panel parses the nodeId, looks up
 * the secret from the `nodes.heartbeat_secret` column, recomputes the
 * HMAC, and compares with `timingSafeEqual`. If `node.deletedAt` is set
 * we return 410 Gone; the agent counts consecutive 410s and self-stops.
 *
 * Why HMAC over JWT: zero state on the panel side beyond the per-node
 * secret already in the DB row, no signing-key rotation concerns, no
 * extra dependency. The secret never leaves the panel, only the HMAC
 * does.
 */
export function signHeartbeatToken(nodeId: string, secret: Buffer): string {
  const sig = createHmac('sha256', secret).update(nodeId).digest('base64url');
  return `${nodeId}.${sig}`;
}

export interface VerifiedHeartbeatToken {
  nodeId: string;
}

// Node.id is a Postgres UUID column. A token whose left segment is not a
// well-formed UUID would reach prisma.node.findUnique({ where: { id } }) and
// make Prisma throw P2023 (inconsistent column data), surfacing as a 500
// instead of the intended 401 INVALID_TOKEN. Validate the shape here and
// reject early so a malformed nodeId fails as cleanly as a bad signature.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifyHeartbeatToken(
  token: string,
  lookupSecret: (nodeId: string) => Promise<Buffer | null>,
): Promise<VerifiedHeartbeatToken | null> {
  return (async () => {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    const nodeId = token.slice(0, dot);
    const provided = token.slice(dot + 1);

    // Reject malformed nodeIds before they hit the UUID column lookup, so an
    // invalid id returns 401 (null here) instead of a Prisma P2023 -> 500.
    if (!UUID_V4_RE.test(nodeId)) return null;

    const secret = await lookupSecret(nodeId);
    if (!secret) return null;

    const expected = createHmac('sha256', secret).update(nodeId).digest('base64url');
    // base64url strings are ASCII so a byte-equal compare is the right test;
    // wrap in timingSafeEqual to defang remote timing attacks.
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;

    return { nodeId };
  })();
}
