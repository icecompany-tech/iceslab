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
import { NodeEnginesError, intendedFromReport, resolveNodeEngines } from './node-intended-engines.js';
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

  it('refuses a contradiction', () => {
    expect(refusal(() => resolveNodeEngines({ intendedEngines: ['xray'], singboxEngine: true }))).toBe(
      'INVALID_ENGINES singboxEngine',
    );
  });

  it('takes a node with no core: the agent alone, labelled none', () => {
    expect(resolveNodeEngines({ intendedEngines: [] })).toEqual({ intendedEngines: [], protocol: 'none', singboxEngine: false });
    const tuic = { intendedEngines: ['singbox' as const], protocol: 'tuic', singboxEngine: true };
    expect(resolveNodeEngines({ singboxEngine: false }, tuic)).toEqual({
      intendedEngines: [],
      protocol: 'none',
      singboxEngine: false,
    });
    // And the empty set reads back as empty, not as the row that predates the
    // column (whose label names its one core).
    expect(intendedEngines({ intendedEngines: [], protocol: 'none', singboxEngine: false })).toEqual([]);
    expect(intendedEngines({ intendedEngines: [], protocol: 'hysteria', singboxEngine: false })).toEqual(['hysteria']);
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

  it('creates a node with no core, labelled none, whose install line names none', async () => {
    const empty = await create({ intendedEngines: [] });
    expect(empty.statusCode, empty.body).toBe(201);
    const node = JSON.parse(empty.body);
    expect(node).toMatchObject({ intendedEngines: [], protocol: 'none', singboxEngine: false });
    expect(node.bootstrap.command).not.toContain('--engines');
    expect(node.bootstrap.command).not.toContain('--protocol');
    // It reads back empty too, on GET and in the list.
    const got = JSON.parse((await app.inject({ method: 'GET', url: `/api/nodes/${node.id}`, headers: auth() })).body);
    expect(got).toMatchObject({ intendedEngines: [], protocol: 'none' });
  });

  it('refuses a repeated set', async () => {
    expect((await create({ intendedEngines: ['xray', 'xray'] })).statusCode).toBe(400);
    // A protocol beside the set is no contradiction any more: it is not heard.
    const beside = await create({ intendedEngines: ['hysteria'], protocol: 'xray' });
    expect(beside.statusCode, beside.body).toBe(201);
    expect(JSON.parse(beside.body)).toMatchObject({ intendedEngines: ['hysteria'], protocol: 'hysteria' });
  });

  it('PUT does not edit the set, and neither refuses nor writes what an older screen sends (E42)', async () => {
    const id = JSON.parse((await create({ intendedEngines: ['xray', 'hysteria'] })).body).id as string;
    const kept = { intendedEngines: ['xray', 'hysteria'], protocol: 'xray', singboxEngine: false };
    // The set follows the node's env now (intendedFromReport); a tick edited
    // here would be written back within a poll. An older screen still sends
    // these: 200, and nothing moves.
    for (const body of [
      { intendedEngines: ['amneziawg', 'hysteria'] },
      { intendedEngines: [] },
      { singboxEngine: true },
      { intendedEngines: null },
      { protocol: 'singbox' },
    ]) {
      const res = await put(id, body);
      expect(res.statusCode, `${JSON.stringify(body)}: ${res.body}`).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject(kept);
    }
    // Beside another edit, that edit goes through and the set does not move.
    const renamed = JSON.parse((await put(id, { name: 'eng-renamed', intendedEngines: ['singbox'] })).body);
    expect(renamed).toMatchObject({ name: 'eng-renamed', ...kept });
    const row = await prisma.node.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject(kept);
  });

  it('the next report with declared cores is what writes the set', async () => {
    const id = JSON.parse((await create({ intendedEngines: ['xray'] })).body).id as string;
    await put(id, { intendedEngines: ['hysteria'] }); // ignored
    const row = await prisma.node.findUniqueOrThrow({ where: { id } });
    // What the poller does with a healthcheck that declares xray and amneziawg.
    const write = intendedFromReport(row, ['amneziawg', 'xray']);
    expect(write).toEqual({ intendedEngines: ['xray', 'amneziawg'], protocol: 'xray', singboxEngine: false });
    await prisma.node.update({ where: { id }, data: write! });
    const got = JSON.parse((await app.inject({ method: 'GET', url: `/api/nodes/${id}`, headers: auth() })).body);
    expect(got).toMatchObject({ intendedEngines: ['xray', 'amneziawg'], protocol: 'xray' });
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
