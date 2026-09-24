import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NODE_DTO_FIELDS } from './nodes.mapper.js';

/**
 * E29, stand 24.09 15:10: the new-node form told what the server can take from
 * the nodes already standing, so an empty fleet read as "nothing" and the
 * first node of a fresh panel went out on the old form. The list now names the
 * fields itself; these tests hold the names to the DTO, both ways.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const list = async () =>
  JSON.parse(
    (await app.inject({ method: 'GET', url: '/api/nodes', headers: { authorization: `Bearer ${token}` } })).body,
  ) as { nodes: Record<string, unknown>[]; total: number; fields: string[] };

/** `key` on the DTO, or `rows[].key` on at least one row of an array in it. */
function has(dto: Record<string, unknown>, field: string): boolean {
  const path = /^(\w+)\[\]\.(\w+)$/.exec(field);
  if (!path) return field in dto;
  const holder = dto[path[1]!] as { cores?: unknown[] } | unknown[] | null;
  // `cores` is the stored inventory, { observedAt, cores: [...] }.
  const rows = Array.isArray(holder) ? holder : holder?.cores;
  return Array.isArray(rows) && rows.some((r) => typeof r === 'object' && r !== null && path[2]! in r);
}

describe('the node list names the fields this server renders', () => {
  it('with no node at all, which is the stand: the names come anyway', async () => {
    const body = await list();
    expect(body.total).toBe(0);
    expect(body.fields).toEqual([...NODE_DTO_FIELDS]);
    expect(body.fields).toContain('intendedEngines');
  });

  it('every name is a key the DTO of a reporting node carries', async () => {
    await prisma.node.create({
      data: {
        name: 'ru-01',
        address: 'ru-01.example.com:1337',
        protocol: 'xray',
        heartbeatSecret: randomBytes(32),
        cores: {
          observedAt: new Date().toISOString(),
          cores: [
            { name: 'xray', engine: 'xray', installed: true },
            { name: 'hysteria', engine: 'hysteria', installed: true, reason: 'no inbounds in the last push' },
          ],
        },
      },
    });
    const body = await list();
    const [dto] = body.nodes;
    for (const field of body.fields) {
      expect(has(dto!, field), `the DTO has no ${field}`).toBe(true);
    }
  });

  it('and no optional key of the DTO is left off the list', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'nodes.mapper.ts'), 'utf8');
    const body = /export interface PublicNodeDto \{([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body, 'PublicNodeDto not found in nodes.mapper.ts').toBeDefined();
    const optional = [...body!.matchAll(/^ {2}(\w+)\?:/gm)].map((m) => m[1]!);
    expect(optional.length).toBeGreaterThan(0);
    const listed: readonly string[] = NODE_DTO_FIELDS;
    for (const key of optional) {
      expect(listed, `${key} is optional on the DTO and not named in NODE_DTO_FIELDS`).toContain(key);
    }
  });
});
