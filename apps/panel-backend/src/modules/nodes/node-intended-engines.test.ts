import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { NodeEnginesError, resolveNodeEngines } from './node-intended-engines.js';

/**
 * Node.intendedEngines (core-lifecycle.md section 7): the engines a node is set
 * up to carry, first = primary. `protocol` and `singboxEngine` are derived
 * from it and kept in step; the old body (protocol + singboxEngine) still
 * works and produces the same list.
 */

let app: FastifyInstance;
let token: string;
let seq = 0;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  seq = 0;
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function create(body: Record<string, unknown>) {
  seq += 1;
  return app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name: `eng-${seq}`, address: `eng-${seq}.test`, ...body },
  });
}
const put = (id: string, body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/nodes/${id}`, headers: auth(), payload: body });

describe('resolveNodeEngines', () => {
  it('derives protocol and singboxEngine from the list', () => {
    expect(resolveNodeEngines({ intendedEngines: ['xray', 'hysteria', 'singbox'] })).toEqual({
      intendedEngines: ['xray', 'hysteria', 'singbox'],
      protocol: 'xray',
      singboxEngine: true,
    });
  });

  it('keeps a stored protocol the first engine still serves', () => {
    const stored = { intendedEngines: ['xray' as const], protocol: 'shadowsocks', singboxEngine: false };
    expect(resolveNodeEngines({ intendedEngines: ['xray', 'mtproto'] }, stored).protocol).toBe('shadowsocks');
    expect(resolveNodeEngines({ intendedEngines: ['hysteria', 'xray'] }, stored).protocol).toBe('hysteria');
  });

  it('refuses a contradiction instead of picking a side', () => {
    const bad = [
      () => resolveNodeEngines({ intendedEngines: ['hysteria'], protocol: 'xray' }),
      () => resolveNodeEngines({ intendedEngines: ['singbox', 'xray'] }),
      () => resolveNodeEngines({ intendedEngines: ['xray'], singboxEngine: true }),
    ];
    const paths = bad.map((f) => {
      try {
        f();
        return 'no throw';
      } catch (e) {
        return (e as NodeEnginesError).path;
      }
    });
    expect(paths).toEqual(['protocol', 'protocol', 'singboxEngine']);
    // A sing-box primary with its protocol named is fine.
    expect(resolveNodeEngines({ intendedEngines: ['singbox'], protocol: 'tuic' })).toEqual({
      intendedEngines: ['singbox'],
      protocol: 'tuic',
      singboxEngine: true,
    });
  });

  it('reads the old body the way it always meant', () => {
    expect(resolveNodeEngines({})).toEqual({ intendedEngines: ['xray'], protocol: 'xray', singboxEngine: false });
    expect(resolveNodeEngines({ protocol: 'hysteria', singboxEngine: true }).intendedEngines).toEqual([
      'hysteria',
      'singbox',
    ]);
    const stored = { intendedEngines: ['xray' as const, 'hysteria' as const, 'singbox' as const], protocol: 'xray', singboxEngine: true };
    // protocol alone moves the primary and keeps the rest.
    expect(resolveNodeEngines({ protocol: 'hysteria' }, stored).intendedEngines).toEqual(['hysteria', 'xray', 'singbox']);
    // The old toggle alone removes sing-box, never a sing-box primary.
    expect(resolveNodeEngines({ singboxEngine: false }, stored).intendedEngines).toEqual(['xray', 'hysteria']);
    const tuic = { intendedEngines: ['singbox' as const], protocol: 'tuic', singboxEngine: true };
    expect(resolveNodeEngines({ singboxEngine: false }, tuic).intendedEngines).toEqual(['singbox']);
  });
});

describe('POST and PUT /api/nodes with intendedEngines', () => {
  it('creates a node with three engines, protocol and singboxEngine derived', async () => {
    const res = await create({ intendedEngines: ['xray', 'hysteria', 'singbox'] });
    expect(res.statusCode, res.body).toBe(201);
    const node = JSON.parse(res.body);
    expect(node).toMatchObject({
      intendedEngines: ['xray', 'hysteria', 'singbox'],
      protocol: 'xray',
      singboxEngine: true,
    });
    const row = await prisma.node.findUniqueOrThrow({ where: { id: node.id } });
    expect(row).toMatchObject({ intendedEngines: ['xray', 'hysteria', 'singbox'], protocol: 'xray', singboxEngine: true });
  });

  it('still takes the old body and answers with the list', async () => {
    const res = await create({ protocol: 'hysteria', singboxEngine: true });
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body).intendedEngines).toEqual(['hysteria', 'singbox']);
    const bare = JSON.parse((await create({})).body);
    expect(bare).toMatchObject({ protocol: 'xray', intendedEngines: ['xray'], singboxEngine: false });
  });

  it('refuses a contradiction with the field, and an empty or repeated list', async () => {
    const clash = await create({ intendedEngines: ['hysteria'], protocol: 'xray' });
    expect(clash.statusCode).toBe(400);
    expect(JSON.parse(clash.body)).toMatchObject({ error: 'INVALID_ENGINES', path: ['protocol'] });
    expect((await create({ intendedEngines: [] })).statusCode).toBe(400);
    expect((await create({ intendedEngines: ['xray', 'xray'] })).statusCode).toBe(400);
  });

  it('PUT follows the three-value rule', async () => {
    const id = JSON.parse((await create({ intendedEngines: ['xray', 'hysteria'] })).body).id as string;
    // An unrelated edit leaves the list alone.
    const renamed = JSON.parse((await put(id, { name: 'eng-renamed' })).body);
    expect(renamed.intendedEngines).toEqual(['xray', 'hysteria']);
    // A list replaces the list; the order matters only for the first.
    const moved = JSON.parse((await put(id, { intendedEngines: ['hysteria', 'xray', 'amneziawg'] })).body);
    expect(moved).toMatchObject({ intendedEngines: ['hysteria', 'xray', 'amneziawg'], protocol: 'hysteria', singboxEngine: false });
    // The old toggle adds sing-box to the list.
    const toggled = JSON.parse((await put(id, { singboxEngine: true })).body);
    expect(toggled.intendedEngines).toEqual(['hysteria', 'xray', 'amneziawg', 'singbox']);
    expect((await put(id, { intendedEngines: null })).statusCode).toBe(400);
  });
});

describe('the migration backfill', () => {
  const MIGRATION = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../prisma/migrations/20260924012425_node_intended_engines/migration.sql',
  );
  /** The migration's UPDATE, read out of the file so the file is what is tested. */
  function backfill(): string {
    const sql = readFileSync(MIGRATION, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const update = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).find((s) => s.startsWith('UPDATE'));
    if (!update) throw new Error('no UPDATE in the migration');
    return update;
  }

  it('fills three kinds of rows the way readIntendedEngines derives them', async () => {
    const rows = [
      { name: 'bf-ss', protocol: 'shadowsocks', singboxEngine: true, want: ['xray', 'singbox'] },
      { name: 'bf-tuic', protocol: 'tuic', singboxEngine: true, want: ['singbox'] },
      { name: 'bf-hy', protocol: 'hysteria', singboxEngine: false, want: ['hysteria'] },
    ];
    for (const r of rows) {
      // Inserted the way a row predating the column looks: the default '{}'.
      await prisma.node.create({
        data: {
          name: r.name,
          address: `${r.name}.test`,
          protocol: r.protocol,
          singboxEngine: r.singboxEngine,
          heartbeatSecret: randomBytes(32),
        },
      });
    }
    // Before the backfill the empty column already reads as the same list.
    for (const r of rows) {
      const row = await prisma.node.findFirstOrThrow({ where: { name: r.name } });
      expect(row.intendedEngines).toEqual([]);
      const dto = JSON.parse(
        (await app.inject({ method: 'GET', url: `/api/nodes/${row.id}`, headers: auth() })).body,
      );
      expect(dto.intendedEngines, `${r.name} before`).toEqual(r.want);
    }
    await prisma.$executeRawUnsafe(backfill());
    for (const r of rows) {
      const row = await prisma.node.findFirstOrThrow({ where: { name: r.name } });
      expect(row.intendedEngines, r.name).toEqual(r.want);
      // And the API reads the same list off the row.
      const dto = JSON.parse(
        (await app.inject({ method: 'GET', url: `/api/nodes/${row.id}`, headers: auth() })).body,
      );
      expect(dto.intendedEngines, r.name).toEqual(r.want);
    }
    // A second run touches nothing: only empty rows are filled.
    await prisma.node.updateMany({ where: { name: 'bf-hy' }, data: { intendedEngines: ['hysteria', 'mieru'] } });
    await prisma.$executeRawUnsafe(backfill());
    expect((await prisma.node.findFirstOrThrow({ where: { name: 'bf-hy' } })).intendedEngines).toEqual(['hysteria', 'mieru']);
  });
});
