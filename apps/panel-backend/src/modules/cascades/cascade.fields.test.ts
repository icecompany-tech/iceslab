import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { CASCADE_DTO_FIELDS, mapCascade } from './cascade.mapper.js';

/**
 * The E29 trap on cascades, 24.09: the create screen asked the cascades
 * standing whether the server knows `entryPolicy`, and a panel with none read
 * that as "no", so the entry policy selector never showed on the first
 * cascade. The list now names the fields itself; these tests hold the names to
 * the DTO, both ways.
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

/** `key` on the DTO, or `rows[].key` on at least one row of an array in it. */
function has(dto: Record<string, unknown>, field: string): boolean {
  const path = /^(\w+)\[\]\.(\w+)$/.exec(field);
  if (!path) return field in dto;
  const rows = dto[path[1]!];
  return Array.isArray(rows) && rows.some((r) => typeof r === 'object' && r !== null && path[2]! in r);
}

describe('the cascade list names the fields this server renders', () => {
  it('with no cascade at all: the names come anyway', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cascades', headers: { authorization: `Bearer ${token}` } });
    const body = JSON.parse(res.body) as { cascades: unknown[]; fields: string[] };
    expect(body.cascades).toEqual([]);
    expect(body.fields).toEqual([...CASCADE_DTO_FIELDS]);
    expect(body.fields).toContain('entryPolicy');
  });

  it('every name is a key the DTO of a cascade carries, a narrow row included', () => {
    // The narrowest row the mapper takes: no policy, no leg columns selected.
    // The keys must be there all the same, which is what the names promise.
    const dto = mapCascade({
      id: 'c1',
      name: 'eu',
      enabled: true,
      mode: 'chain',
      hideHopsFromSub: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      hops: [],
      positions: [{ position: 0, entryProtocol: 'xray', linkProtocol: 'xray', nodes: [{ nodeId: 'n1' }] }],
      directions: [{ id: 'd1', tag: 1, countryCode: 'de', nodes: [{ nodeId: 'n2' }] }],
    }) as unknown as Record<string, unknown>;
    for (const field of CASCADE_DTO_FIELDS) {
      expect(has(dto, field), `the DTO has no ${field}`).toBe(true);
    }
  });

  it('and no optional key of the DTO or its rows is left off the list', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cascade.mapper.ts'), 'utf8');
    // Each DTO interface and the name its keys go by in the list.
    const prefix: Record<string, string> = {
      CascadeDto: '',
      CascadeHopDto: 'hops[].',
      CascadePositionDto: 'positions[].',
      CascadeDirectionDto: 'directions[].',
      CascadeTunnelDto: 'tunnels[].',
    };
    const listed: readonly string[] = CASCADE_DTO_FIELDS;
    for (const [name, at] of Object.entries(prefix)) {
      const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1];
      expect(body, `${name} not found in cascade.mapper.ts`).toBeDefined();
      for (const m of body!.matchAll(/^ {2}(\w+)\?:/gm)) {
        expect(listed, `${at}${m[1]} is optional on the DTO and not named in CASCADE_DTO_FIELDS`).toContain(
          `${at}${m[1]}`,
        );
      }
    }
    // A new DTO interface in the file has to be added above, or its optional
    // keys would go unread.
    const declared = [...src.matchAll(/^export interface (\w+Dto) \{/gm)].map((m) => m[1]!);
    expect(declared.sort()).toEqual(Object.keys(prefix).sort());
  });
});
