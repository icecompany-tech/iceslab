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
import { intendedEngines } from './node-engines.js';

/**
 * Node.intendedEngines (core-lifecycle.md section 7): the engines a node is set
 * up to carry, a set with no main core (25.09). `protocol` and `singboxEngine`
 * are derived from it and kept in step; the old create body (protocol +
 * singboxEngine) still works and produces the same set.
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

const refusal = (f: () => unknown) => {
  try {
    f();
    return 'no throw';
  } catch (e) {
    return `${(e as NodeEnginesError).code} ${(e as NodeEnginesError).path}`;
  }
};

describe('resolveNodeEngines', () => {
  it('derives protocol and singboxEngine from the set', () => {
    expect(resolveNodeEngines({ intendedEngines: ['xray', 'hysteria', 'singbox'] })).toEqual({
      intendedEngines: ['xray', 'hysteria', 'singbox'],
      protocol: 'xray',
      singboxEngine: true,
    });
  });

  it('is a set: no core is first, the label is xray if present, else the first by ENGINE_NAMES', () => {
    expect(resolveNodeEngines({ intendedEngines: ['singbox', 'xray'] })).toEqual({
      intendedEngines: ['xray', 'singbox'],
      protocol: 'xray',
      singboxEngine: true,
    });
    expect(resolveNodeEngines({ intendedEngines: ['mtproto', 'amneziawg', 'hysteria'] })).toMatchObject({
      intendedEngines: ['hysteria', 'amneziawg', 'mtproto'],
      protocol: 'hysteria',
    });
    expect(resolveNodeEngines({ intendedEngines: ['singbox'] }).protocol).toBe('singbox');
    // A stored label is not kept: it is derived, whatever it said before.
    const stored = { intendedEngines: ['xray' as const], protocol: 'shadowsocks', singboxEngine: false };
    expect(resolveNodeEngines({ intendedEngines: ['hysteria', 'xray'] }, stored).protocol).toBe('xray');
  });

  it('ignores a protocol sent beside the set, and on an update', () => {
    expect(resolveNodeEngines({ intendedEngines: ['hysteria'], protocol: 'xray' })).toEqual({
      intendedEngines: ['hysteria'],
      protocol: 'hysteria',
      singboxEngine: false,
    });
    const stored = { intendedEngines: ['xray' as const, 'hysteria' as const], protocol: 'xray', singboxEngine: false };
    expect(resolveNodeEngines({ protocol: 'mieru' }, stored).intendedEngines).toEqual(['xray', 'hysteria']);
  });

  it('refuses a contradiction, and a node left without a core', () => {
    expect(refusal(() => resolveNodeEngines({ intendedEngines: ['xray'], singboxEngine: true }))).toBe(
      'INVALID_ENGINES singboxEngine',
    );
    expect(refusal(() => resolveNodeEngines({ intendedEngines: [] }))).toBe('LAST_CORE intendedEngines');
    const tuic = { intendedEngines: ['singbox' as const], protocol: 'tuic', singboxEngine: true };
    expect(refusal(() => resolveNodeEngines({ singboxEngine: false }, tuic))).toBe('LAST_CORE singboxEngine');
  });

  it('reads the old create body the way it always meant', () => {
    expect(resolveNodeEngines({})).toEqual({ intendedEngines: ['xray'], protocol: 'xray', singboxEngine: false });
    expect(resolveNodeEngines({ protocol: 'hysteria', singboxEngine: true }).intendedEngines).toEqual([
      'hysteria',
      'singbox',
    ]);
    expect(resolveNodeEngines({ protocol: 'tuic' })).toMatchObject({ intendedEngines: ['singbox'], singboxEngine: true });
    const stored = { intendedEngines: ['xray' as const, 'hysteria' as const, 'singbox' as const], protocol: 'xray', singboxEngine: true };
    // The old toggle alone removes sing-box.
    expect(resolveNodeEngines({ singboxEngine: false }, stored).intendedEngines).toEqual(['xray', 'hysteria']);
  });
});

describe('the fallback engines of a node without a stored set', () => {
  it('the order of a stored set does not matter', () => {
    const a = intendedEngines({ intendedEngines: ['singbox', 'hysteria', 'xray'], protocol: 'hysteria', singboxEngine: true });
    const b = intendedEngines({ intendedEngines: ['xray', 'singbox', 'hysteria'], protocol: 'xray', singboxEngine: true });
    expect(a).toEqual(['xray', 'hysteria', 'singbox']);
    expect(b).toEqual(a);
  });

  it('only a row with no set falls back to its label, the one it was installed with', () => {
    expect(intendedEngines({ intendedEngines: [], protocol: 'shadowsocks', singboxEngine: true })).toEqual(['xray', 'singbox']);
    // With a set, the label says nothing.
    expect(intendedEngines({ intendedEngines: ['hysteria'], protocol: 'xray', singboxEngine: false })).toEqual(['hysteria']);
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

  it('creates a sing-box and xray node without a 400, labelled xray', async () => {
    const res = await create({ intendedEngines: ['singbox', 'xray'] });
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ intendedEngines: ['xray', 'singbox'], protocol: 'xray', singboxEngine: true });
    // And its install line names the set, no --protocol.
    const cmd = JSON.parse(res.body).bootstrap.command as string;
    expect(cmd).toContain('--engines xray,singbox');
    expect(cmd).not.toContain('--protocol');
  });

  it('refuses an empty set by name, and a repeated one', async () => {
    const empty = await create({ intendedEngines: [] });
    expect(empty.statusCode).toBe(400);
    expect(JSON.parse(empty.body)).toMatchObject({ error: 'LAST_CORE', path: ['intendedEngines'] });
    expect((await create({ intendedEngines: ['xray', 'xray'] })).statusCode).toBe(400);
    // A protocol beside the set is no contradiction any more: it is not heard.
    const beside = await create({ intendedEngines: ['hysteria'], protocol: 'xray' });
    expect(beside.statusCode, beside.body).toBe(201);
    expect(JSON.parse(beside.body)).toMatchObject({ intendedEngines: ['hysteria'], protocol: 'hysteria' });
  });

  it('PUT follows the three-value rule, and a protocol in its body is ignored', async () => {
    const id = JSON.parse((await create({ intendedEngines: ['xray', 'hysteria'] })).body).id as string;
    // An unrelated edit leaves the set alone.
    const renamed = JSON.parse((await put(id, { name: 'eng-renamed' })).body);
    expect(renamed.intendedEngines).toEqual(['xray', 'hysteria']);
    // protocol is not an edit: no 400, nothing moves, even for a label the
    // enum lacks (a sing-box-only node reads `singbox`).
    for (const protocol of ['hysteria', 'singbox']) {
      const res = await put(id, { protocol });
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ intendedEngines: ['xray', 'hysteria'], protocol: 'xray' });
    }
    // A set replaces the set; its order says nothing.
    const moved = JSON.parse((await put(id, { intendedEngines: ['amneziawg', 'hysteria'] })).body);
    expect(moved).toMatchObject({ intendedEngines: ['hysteria', 'amneziawg'], protocol: 'hysteria', singboxEngine: false });
    // The old toggle adds sing-box to the set.
    const toggled = JSON.parse((await put(id, { singboxEngine: true })).body);
    expect(toggled.intendedEngines).toEqual(['hysteria', 'singbox', 'amneziawg']);
    expect((await put(id, { intendedEngines: null })).statusCode).toBe(400);
  });

  it('refuses to remove the last core: LAST_CORE', async () => {
    const id = JSON.parse((await create({ intendedEngines: ['singbox'] })).body).id as string;
    for (const body of [{ intendedEngines: [] }, { singboxEngine: false }]) {
      const res = await put(id, body);
      expect(res.statusCode, res.body).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'LAST_CORE' });
    }
    const row = await prisma.node.findUniqueOrThrow({ where: { id } });
    expect(row.intendedEngines).toEqual(['singbox']);
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
