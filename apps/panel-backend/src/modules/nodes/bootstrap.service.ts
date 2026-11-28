import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Node } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { buildNodePayload } from './node-payload.js';
import { resolveCoreVersions, type BootstrapCoreVersions } from '@iceslab/shared';
import { readCoreVersions } from './node-core-versions.js';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const INSTALL_TOKEN_PREFIX = 'bs_';
const FILE_TOKEN_PREFIX = 'bf_';

export const BootstrapFileTokenPattern = /^bf_[A-Za-z0-9_-]{54}$/;

export class BootstrapTokenError extends Error {
  constructor(
    public reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'CORE_VERSION_NOT_LISTED' | 'BOOTSTRAP_CONFIG_CHANGED',
    public httpStatus: number,
    detail?: string,
  ) {
    super(detail ?? `Bootstrap token ${reason.toLowerCase()}`);
    this.name = 'BootstrapTokenError';
  }
}

async function storeBootstrapToken(nodeId: string, token: string, storedToken = token) {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await prisma.nodeBootstrapToken.create({ data: { nodeId, token: storedToken, expiresAt } });
  return { token, expiresAt };
}

export function issueBootstrapToken(nodeId: string) {
  return storeBootstrapToken(nodeId, INSTALL_TOKEN_PREFIX + randomBytes(24).toString('base64url'));
}

type FileInstallSettings = Pick<Node,
  'id' | 'name' | 'address' | 'protocol' | 'intendedEngines' | 'singboxEngine' |
  'hardening' | 'coreVersions' | 'heartbeatSecret'>;

function fileTicketSignature(node: FileInstallSettings, nonce: string): Buffer {
  // Sign the fields the command and payload depend on, separately from the
  // heartbeat bearer. Periodic health reports do not invalidate a ticket.
  return createHmac('sha256', node.heartbeatSecret)
    .update(JSON.stringify([
      'node-bootstrap-file/v1', nonce, node.id, node.name, node.address, node.protocol,
      node.intendedEngines, node.singboxEngine, node.hardening, node.coreVersions,
    ]))
    .digest().subarray(0, 16);
}

export function issueBootstrapFileToken(node: FileInstallSettings) {
  const nonce = randomBytes(24).toString('base64url');
  const signature = fileTicketSignature(node, nonce).toString('base64url');
  const token = FILE_TOKEN_PREFIX + nonce + signature;
  return storeBootstrapToken(node.id, token, fileTicketKey(token));
}

function fileTicketKey(token: string): string {
  // A database or query log receives a locator that cannot redeem the file.
  return 'bf#' + createHash('sha256').update(token).digest('base64url');
}

function isFileTicketCurrent(node: FileInstallSettings, token: string): boolean {
  const nonce = token.slice(FILE_TOKEN_PREFIX.length, FILE_TOKEN_PREFIX.length + 32);
  const signature = Buffer.from(token.slice(FILE_TOKEN_PREFIX.length + 32), 'base64url');
  return signature.length === 16 && timingSafeEqual(signature, fileTicketSignature(node, nonce));
}

function coreVersionsFor(node: Pick<Node, 'coreVersions'>): BootstrapCoreVersions {
  try {
    return resolveCoreVersions(readCoreVersions(node.coreVersions));
  } catch (err) {
    throw new BootstrapTokenError(
      'CORE_VERSION_NOT_LISTED',
      409,
      `${(err as Error).message}. Put that core back on the pin on the node's page and run the install again.`,
    );
  }
}

function verifyUnused(row: { consumedAt: Date | null; expiresAt: Date }) {
  if (row.consumedAt) throw new BootstrapTokenError('CONSUMED', 410);
  if (row.expiresAt.getTime() <= Date.now()) throw new BootstrapTokenError('EXPIRED', 410);
}

/** Same one-shot network bootstrap used by existing installers. */
export async function redeemBootstrapToken(token: string): Promise<string> {
  if (!token.startsWith(INSTALL_TOKEN_PREFIX)) throw new BootstrapTokenError('NOT_FOUND', 404);
  const row = await prisma.nodeBootstrapToken.findUnique({
    where: { token },
    include: { node: true },
  });
  if (!row) throw new BootstrapTokenError('NOT_FOUND', 404);
  verifyUnused(row);
  if (row.node.deletedAt) throw new BootstrapTokenError('NOT_FOUND', 404);
  const coreVersions = coreVersionsFor(row.node);
  const claim = await prisma.nodeBootstrapToken.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claim.count === 0) throw new BootstrapTokenError('CONSUMED', 410);
  return buildNodePayload(row.node, coreVersions);
}

/** Called only after the operator's session was authenticated. */
export async function redeemBootstrapFileToken(nodeId: string, token: string): Promise<string> {
  if (!BootstrapFileTokenPattern.test(token)) throw new BootstrapTokenError('NOT_FOUND', 404);
  const { node, coreVersions } = await prisma.$transaction(async (tx) => {
    // Serialize registry edits/deletion with the acceptance of the file ticket.
    // The certificate is minted after releasing the lock, as in network bootstrap.
    await tx.$queryRaw`SELECT id FROM nodes WHERE id = ${nodeId}::uuid FOR SHARE`;
    const row = await tx.nodeBootstrapToken.findUnique({ where: { token: fileTicketKey(token) }, include: { node: true } });
    if (!row || row.nodeId !== nodeId || row.node.deletedAt) throw new BootstrapTokenError('NOT_FOUND', 404);
    verifyUnused(row);
    if (!isFileTicketCurrent(row.node, token)) {
      throw new BootstrapTokenError('BOOTSTRAP_CONFIG_CHANGED', 409, 'Node installation settings changed. Request a new download.');
    }
    const coreVersions = coreVersionsFor(row.node);
    const now = new Date();
    const claim = await tx.nodeBootstrapToken.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claim.count === 0) {
      const current = await tx.nodeBootstrapToken.findUnique({ where: { id: row.id }, select: { consumedAt: true } });
      if (!current) throw new BootstrapTokenError('NOT_FOUND', 404);
      throw current.consumedAt
        ? new BootstrapTokenError('CONSUMED', 410)
        : new BootstrapTokenError('EXPIRED', 410);
    }
    return { node: row.node, coreVersions };
  });
  return buildNodePayload(node, coreVersions);
}

export async function purgeExpiredBootstrapTokens(): Promise<number> {
  const result = await prisma.nodeBootstrapToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] },
  });
  return result.count;
}
