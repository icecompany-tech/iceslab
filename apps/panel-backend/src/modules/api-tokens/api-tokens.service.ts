import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';

const TOKEN_PREFIX = 'icp_';

export interface PublicApiTokenDto {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export class ApiTokenNotFoundError extends Error {
  constructor(public id: string) {
    super(`API token ${id} not found`);
    this.name = 'ApiTokenNotFoundError';
  }
}

export class ApiTokenNameTakenError extends Error {
  constructor(public name: string) {
    super(`API token "${name}" already exists`);
    this.name = 'ApiTokenNameTakenError';
  }
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function mapToken(t: {
  id: string;
  name: string;
  scopes: unknown;
  lastUsedAt: Date | null;
  createdAt: Date;
}): PublicApiTokenDto {
  return {
    id: t.id,
    name: t.name,
    scopes: Array.isArray(t.scopes) ? (t.scopes as string[]) : [],
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Create a new API token. Returns the plaintext token ONCE, admin must
 * copy it now, the panel never shows it again (only the SHA-256 hash is
 * stored). Subsequent reads return everything except the secret.
 */
export async function createToken(
  name: string,
  scopes: string[] = [],
  createdByAdminId: string | null = null,
): Promise<{ token: PublicApiTokenDto; plaintext: string }> {
  const existing = await prisma.apiToken.findFirst({ where: { name } });
  if (existing) throw new ApiTokenNameTakenError(name);

  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const tokenHash = hashToken(plaintext);

  const row = await prisma.apiToken.create({
    data: { name, tokenHash, scopes, createdByAdminId },
  });
  return { token: mapToken(row), plaintext };
}

export async function listTokens(): Promise<PublicApiTokenDto[]> {
  const rows = await prisma.apiToken.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(mapToken);
}

export async function deleteToken(id: string): Promise<void> {
  const existing = await prisma.apiToken.findUnique({ where: { id } });
  if (!existing) throw new ApiTokenNotFoundError(id);
  await prisma.apiToken.delete({ where: { id } });
}
