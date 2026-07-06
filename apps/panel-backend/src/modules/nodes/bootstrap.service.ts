import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import {
  issueNodeCert,
  encodeNodePayload,
  getPanelClientFingerprint,
} from '../keygen/keygen.service.js';
import { config } from '../../config.js';
import { signHeartbeatToken } from './heartbeat-token.js';

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TOKEN_PREFIX = 'bs_';

export class BootstrapTokenError extends Error {
  constructor(
    public reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED',
    public httpStatus: number,
  ) {
    super(`Bootstrap token ${reason.toLowerCase()}`);
    this.name = 'BootstrapTokenError';
  }
}

/**
 * Issue a single-use bootstrap token for the given node. Token has a 15-min
 * TTL, admin is expected to copy the install command and run it on the
 * node within that window. After redemption (or expiry) it can no longer
 * be used; admin issues a fresh one if needed.
 */
export async function issueBootstrapToken(nodeId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  // 24 random bytes → 32-char base64url. Short enough to paste through any
  // TTY, long enough to be unguessable (192 bits of entropy).
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.nodeBootstrapToken.create({
    data: { nodeId, token, expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Redeem a bootstrap token: returns a freshly-generated mTLS payload for
 * the matching node and marks the token consumed. The payload is generated
 * here rather than stored at issue time so the panel never persists a
 * private key beyond the few milliseconds this function takes.
 *
 * Throws `BootstrapTokenError` for not-found / expired / already-consumed
 * tokens with the right HTTP status code attached.
 */
export async function redeemBootstrapToken(token: string): Promise<string> {
  const row = await prisma.nodeBootstrapToken.findUnique({
    where: { token },
    include: { node: true },
  });
  if (!row) throw new BootstrapTokenError('NOT_FOUND', 404);
  if (row.consumedAt) throw new BootstrapTokenError('CONSUMED', 410);
  if (row.expiresAt.getTime() < Date.now()) throw new BootstrapTokenError('EXPIRED', 410);
  if (row.node.deletedAt) throw new BootstrapTokenError('NOT_FOUND', 404);

  // Mark consumed FIRST: race-safe single-use. Even a concurrent second
  // redeem hits this same row's `consumedAt` and the unique-on-(id+null)
  // pattern below stops it.
  const claim = await prisma.nodeBootstrapToken.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claim.count === 0) {
    // Lost the race, somebody else just consumed it.
    throw new BootstrapTokenError('CONSUMED', 410);
  }

  const cert = await issueNodeCert({
    commonName: row.node.name,
    sans: buildSans(row.node.address),
  });
  // Slice 38: bundle heartbeat-self-destruct credentials. The agent will
  // poll PANEL_URL/api/internal/nodes/me/status with this token and exit
  // on 410 Gone. heartbeat_secret was generated at node-create time (or
  // backfilled by the migration) and never leaves the panel, only the
  // HMAC of it does.
  const secretBuf = Buffer.from(row.node.heartbeatSecret as Uint8Array);
  const panelClientFingerprint = await getPanelClientFingerprint();
  return encodeNodePayload({
    ...cert,
    panelUrl: config.PUBLIC_URL,
    nodeId: row.node.id,
    heartbeatToken: signHeartbeatToken(row.node.id, secretBuf),
    panelClientFingerprint,
  });
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
function buildSans(address: string): { type: 'dns' | 'ip'; value: string }[] {
  const host = address.split(':')[0]!;
  return [{ type: IPV4_RE.test(host) ? 'ip' : 'dns', value: host }];
}

/**
 * Background-cleanup helper. Not wired to a cron yet, periodically delete
 * tokens past their TTL. Slice 24+ may schedule this every hour.
 */
export async function purgeExpiredBootstrapTokens(): Promise<number> {
  const result = await prisma.nodeBootstrapToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] },
  });
  return result.count;
}
