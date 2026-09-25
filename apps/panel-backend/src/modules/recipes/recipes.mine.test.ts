import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Recipe, RecipeRegistryResponse } from '@iceslab/shared';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { bustSourceCache } from './recipes.registry.js';
import { getRecipeSnapshot } from './recipes.snapshot.js';
import { RecipeSchema } from './recipes.schemas.js';

/**
 * The operator's own and hidden recipes, the contract of 25.09: one recipe per
 * id merged by the server (own, then sources, then the snapshot), the losers
 * named in `alsoIn`; a save upserts by id; hidden ids stay in `recipes`. And
 * the three refusals of an import told apart in words, and a profile exported
 * as a registry recipe.
 *
 * The network is stubbed: every source answers 404, so what the registry
 * serves is the snapshot and what the test saved.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  bustSourceCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('404: Not Found', { status: 404 })));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });
const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, headers: auth(), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const registry = async () => (await call('GET', '/api/recipes/registry')).body as RecipeRegistryResponse;
const importJson = (doc: unknown, save?: boolean) =>
  call('POST', '/api/recipes/import', { json: JSON.stringify(doc), ...(save !== undefined ? { save } : {}) });

// A registry recipe, renamed: the operator's own version of it.
const snap = (id: string) => getRecipeSnapshot().recipes.find((r) => r.id === id)!;
const own = (id: string, name: string): Recipe => {
  const { verified: _v, ...r } = snap(id);
  void _v;
  return { ...r, name };
};

describe('own recipes: saved on import, one per id', () => {
  it('replaced tells the two branches apart, and the table keeps one row', async () => {
    const first = await importJson(own('hysteria-default', 'Mine, v1'), true);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.saved).toEqual({ id: 'hysteria-default', replaced: false });
    const second = await importJson(own('hysteria-default', 'Mine, v2'), true);
    expect(second.body.saved).toEqual({ id: 'hysteria-default', replaced: true });
    expect(await prisma.operatorRecipe.count()).toBe(1);
    // Without save nothing is stored, and saved is null.
    const plain = await importJson(own('tuic-bbr', 'Not kept'));
    expect(plain.body.saved).toBeNull();
    expect(await prisma.operatorRecipe.count()).toBe(1);
  });

  it('wins over the snapshot by id, which is named in alsoIn', async () => {
    await importJson(own('hysteria-default', 'Mine'), true);
    const res = await registry();
    const hy = res.recipes.filter((r) => r.id === 'hysteria-default');
    expect(hy).toHaveLength(1);
    expect(hy[0]).toMatchObject({ name: 'Mine', sourceId: 'mine', sourceName: 'mine', alsoIn: ['builtin'], verified: false });
    // One recipe per id across the whole answer.
    expect(new Set(res.recipes.map((r) => r.id)).size).toBe(res.recipes.length);
  });

  it('delete: 204, then 404 RECIPE_NOT_FOUND, and the snapshot recipe is back', async () => {
    await importJson(own('hysteria-default', 'Mine'), true);
    expect((await call('DELETE', '/api/recipes/mine/hysteria-default')).status).toBe(204);
    const again = await call('DELETE', '/api/recipes/mine/hysteria-default');
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ error: 'RECIPE_NOT_FOUND' });
    const hy = (await registry()).recipes.find((r) => r.id === 'hysteria-default');
    expect(hy).toMatchObject({ sourceId: 'builtin' });
    expect(hy?.alsoIn).toBeUndefined();
  });

  it('save keeps one recipe: an import of several is refused in words', async () => {
    const res = await importJson([own('hysteria-default', 'a'), own('tuic-bbr', 'b')], true);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('save keeps one recipe, and this holds 2: hysteria-default, tuic-bbr');
  });
});

describe('hidden recipes', () => {
  it('hide and show back; hidden ones stay in recipes', async () => {
    const put = await call('PUT', '/api/recipes/hidden', { ids: ['tuic-bbr', 'awg-iran'] });
    expect(put).toEqual({ status: 200, body: { hidden: ['awg-iran', 'tuic-bbr'] } });
    let res = await registry();
    expect(res.hidden).toEqual(['awg-iran', 'tuic-bbr']);
    expect(res.recipes.map((r) => r.id)).toEqual(expect.arrayContaining(['awg-iran', 'tuic-bbr']));
    expect(res.recipes).toHaveLength(getRecipeSnapshot().recipes.length);
    // Show one back: the list is replaced whole.
    await call('PUT', '/api/recipes/hidden', { ids: ['awg-iran'] });
    res = await registry();
    expect(res.hidden).toEqual(['awg-iran']);
  });

  it('drops ids no recipe has without a word, and refuses non-strings', async () => {
    const put = await call('PUT', '/api/recipes/hidden', { ids: ['tuic-bbr', 'gone-from-everywhere', 'tuic-bbr'] });
    expect(put.body).toEqual({ hidden: ['tuic-bbr'] });
    const bad = await call('PUT', '/api/recipes/hidden', { ids: ['tuic-bbr', 42] });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});

describe('import refusals, in words', () => {
  it('a link that is not JSON says what it is', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })),
    );
    const res = await call('POST', '/api/recipes/import', { url: 'https://github.com/o/r/blob/main/recipes/x.json' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'IMPORT_FAILED', message: 'the link does not answer with JSON (text/html)' });
  });

  it('JSON that is neither a recipe nor a registry', async () => {
    const res = await importJson({ hello: 'world' });
    expect(res.body.message).toBe('the JSON is neither a recipe nor a recipe registry');
  });

  it('recipes, none of which passes: the reason of the first; v1 by name', async () => {
    const v1 = { ...own('tuic-bbr', 'old'), schemaVersion: 1 };
    const one = await importJson(v1);
    expect(one.body.message).toBe('recipe tuic-bbr: recipe schemaVersion 1 is not read any more, see the registry README');
    const noSub = { ...own('xray-reality-xhttp', 'x') } as Partial<Recipe>;
    delete noSub.subprotocol;
    const two = await importJson({ schemaVersion: 2, recipes: [noSub, v1] });
    expect(two.body.message).toBe(
      'none of the 2 recipes passes: recipe xray-reality-xhttp: subprotocol: an xray recipe names its subprotocol: vless, vmess, trojan, socks, http',
    );
  });

  it('a single recipe file (not an index) imports as itself', async () => {
    const res = await importJson(own('tuic-bbr', 'single'));
    expect(res.status).toBe(200);
    expect(res.body.recipes.map((r: Recipe) => r.id)).toEqual(['tuic-bbr']);
  });
});

describe('GET /api/profiles/:id/recipe', () => {
  it('a vless+REALITY profile exports as a recipe the schema takes, secrets out, randomized fields as draws', async () => {
    const profile = await prisma.profile.create({
      data: {
        name: 'My VLESS gRPC (RU)',
        protocol: 'xray',
        description: 'gRPC for mobile networks',
        config: {
          subprotocol: 'vless',
          network: 'grpc',
          serviceName: 'svc7a1b2c3d',
          realityDest: 'avatars.mds.yandex.net:443',
          realityServerNames: ['avatars.mds.yandex.net'],
          realityPrivateKey: 'PRIVATE-KEY-MUST-NOT-LEAVE',
          realityPublicKey: 'public-key-value',
          realityShortIds: ['abcd1234'],
          fingerprint: 'firefox',
          flow: '',
        },
      },
    });
    const res = await call('GET', `/api/profiles/${profile.id}/recipe`);
    expect(res.status).toBe(200);
    expect(RecipeSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      schemaVersion: 2,
      id: 'my-vless-grpc-ru',
      engine: 'native',
      protocol: 'xray',
      subprotocol: 'vless',
      name: 'My VLESS gRPC (RU)',
      description: 'gRPC for mobile networks',
      apply: {
        xraySubprotocol: 'vless',
        xrayNetwork: 'grpc',
        xrayDest: 'avatars.mds.yandex.net:443',
        xrayServerNames: 'avatars.mds.yandex.net',
        xrayFingerprint: 'firefox',
      },
      randomize: [{ field: 'xrayServiceName', kind: 'token8' }],
    });
    const text = JSON.stringify(res.body);
    for (const leak of ['PRIVATE-KEY-MUST-NOT-LEAVE', 'public-key-value', 'abcd1234', 'svc7a1b2c3d']) {
      expect(text).not.toContain(leak);
    }
    // And the import takes it back.
    expect((await importJson(res.body)).status).toBe(200);
  });

  it('404 for a profile that is not there', async () => {
    expect((await call('GET', '/api/profiles/00000000-0000-4000-8000-000000000000/recipe')).status).toBe(404);
  });
});
