import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CORE_VERSIONS } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import {
  CoreVersionIntentError,
  applyCoreVersionsPatch,
  readCoreVersions,
} from './node-core-versions.js';

/**
 * Node.coreVersions: which core versions the operator wants on a node.
 *
 * The write follows the rule of three values the PUT of squads taught us
 * (2026-07-31, a save wiped profileIds): a component the body leaves out is NOT
 * an edit, null puts it back on the pin, a version sets it. And every version
 * has to be one the manifest lists, because that is where it gets its sha256.
 */

// The manifest lists one release per component today, so "a chosen version"
// is the pin written down explicitly: a stored choice all the same.
const XRAY = CORE_VERSIONS.xray.pinned!;
const MTG = CORE_VERSIONS.mtg.pinned!;

describe('applyCoreVersionsPatch', () => {
  it('sets, resets to the pin, and leaves alone what the patch does not name', () => {
    const stored = { xray: XRAY, mtg: MTG };
    expect(applyCoreVersionsPatch(stored, { mtg: null })).toEqual({ xray: XRAY });
    expect(applyCoreVersionsPatch(stored, {})).toEqual(stored);
    expect(applyCoreVersionsPatch({}, { xray: XRAY })).toEqual({ xray: XRAY });
  });

  it('puts every component back on the pin for a null map', () => {
    expect(applyCoreVersionsPatch({ xray: XRAY, mtg: MTG }, null)).toEqual({});
  });

  it('refuses a version the manifest does not list, naming what it does', () => {
    expect(() => applyCoreVersionsPatch({}, { xray: '26.7.28' })).toThrow(CoreVersionIntentError);
    try {
      applyCoreVersionsPatch({}, { xray: '26.7.28' });
    } catch (err) {
      expect((err as CoreVersionIntentError).problems).toEqual([
        `xray: 26.7.28 is not a listed release (${XRAY})`,
      ]);
    }
  });

  it('refuses a stored choice that stopped being listed, so it can be reset', () => {
    // An edit of another component still checks the whole result: the node
    // would otherwise keep an intent the installer can no longer carry out.
    expect(() => applyCoreVersionsPatch({ xray: '1.0.0' }, { mtg: MTG })).toThrow(/xray: 1\.0\.0/);
    expect(applyCoreVersionsPatch({ xray: '1.0.0' }, { xray: null })).toEqual({});
  });
});

describe('readCoreVersions', () => {
  it('reads only known components with string values, and anything else as the pins', () => {
    expect(readCoreVersions({ xray: XRAY, nginx: '1', mtg: 5 })).toEqual({ xray: XRAY });
    expect(readCoreVersions(null)).toEqual({});
    expect(readCoreVersions([])).toEqual({});
  });
});

describe('PUT /api/nodes/:id coreVersions', () => {
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

  async function createNode(extra: Record<string, unknown> = {}) {
    seq += 1;
    return app.inject({
      method: 'POST',
      url: '/api/nodes',
      headers: auth(),
      payload: { name: `cv-${seq}`, address: `cv-${seq}.test`, protocol: 'xray', ...extra },
    });
  }

  async function put(id: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'PUT', url: `/api/nodes/${id}`, headers: auth(), payload });
  }

  async function get(id: string) {
    const res = await app.inject({ method: 'GET', url: `/api/nodes/${id}`, headers: auth() });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as { coreVersions: Record<string, string> };
  }

  it('answers {} for a node nobody chose for: it follows the pins', async () => {
    const created = await createNode();
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;
    expect(JSON.parse(created.body).coreVersions).toEqual({});
    expect((await get(id)).coreVersions).toEqual({});
  });

  it('takes a choice on create', async () => {
    const created = await createNode({ coreVersions: { mtg: MTG } });
    expect(created.statusCode, created.body).toBe(201);
    expect(JSON.parse(created.body).coreVersions).toEqual({ mtg: MTG });
  });

  it('refuses an unlisted version on create, and creates nothing', async () => {
    const created = await createNode({ coreVersions: { xray: '26.7.28' } });
    expect(created.statusCode, created.body).toBe(400);
    expect(JSON.parse(created.body).error).toBe('CORE_VERSION_NOT_LISTED');
    expect(await prisma.node.count()).toBe(0);
  });

  it('holds the three values on PUT', async () => {
    const id = JSON.parse((await createNode()).body).id as string;

    // A value writes.
    expect((await put(id, { coreVersions: { xray: XRAY, mtg: MTG } })).statusCode).toBe(200);
    expect((await get(id)).coreVersions).toEqual({ xray: XRAY, mtg: MTG });

    // No coreVersions key at all: an edit of something else touches nothing.
    expect((await put(id, { maxUsers: 10 })).statusCode).toBe(200);
    expect((await get(id)).coreVersions).toEqual({ xray: XRAY, mtg: MTG });

    // A component left out of the map is untouched; null puts one on the pin.
    expect((await put(id, { coreVersions: { mtg: null } })).statusCode).toBe(200);
    expect((await get(id)).coreVersions).toEqual({ xray: XRAY });

    // null for the whole map: every pin.
    expect((await put(id, { coreVersions: null })).statusCode).toBe(200);
    expect((await get(id)).coreVersions).toEqual({});
  });

  it('refuses an unlisted version and an unknown component, and keeps what was stored', async () => {
    const id = JSON.parse((await createNode({ coreVersions: { mtg: MTG } })).body).id as string;

    const unlisted = await put(id, { coreVersions: { xray: '26.9.8' } });
    expect(unlisted.statusCode, unlisted.body).toBe(400);
    expect(JSON.parse(unlisted.body).problems).toEqual([
      `xray: 26.9.8 is not a listed release (${XRAY})`,
    ]);

    const unknown = await put(id, { coreVersions: { nginx: '1.0' } });
    expect(unknown.statusCode, unknown.body).toBe(400);

    expect((await get(id)).coreVersions).toEqual({ mtg: MTG });
  });

  it('the database refuses anything but an object in the column', async () => {
    const id = JSON.parse((await createNode()).body).id as string;
    await expect(
      prisma.$executeRawUnsafe(`UPDATE nodes SET core_versions = '[]'::jsonb WHERE id = '${id}'`),
    ).rejects.toThrow(/nodes_core_versions_is_object/);
  });
});
