import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { getSubscriptionSettings, invalidateSubscriptionSettingsCache } from './settings.service.js';

/**
 * The delivery settings behind the "Subscription, delivery" screen.
 *
 * app_settings is a jsonb key-value table: a row can be hand-edited, restored
 * from an old dump, or written by a migration. So every read has a fallback,
 * and the fallback is always the behaviour that existed before the setting
 * did. A bad row must never change what subscribers get.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  invalidateSubscriptionSettingsCache();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function put(payload: Record<string, unknown>, expected = 200) {
  const res = await app.inject({ method: 'PUT', url: '/api/settings', headers: auth(), payload });
  expect(res.statusCode, res.body).toBe(expected);
  invalidateSubscriptionSettingsCache();
  return JSON.parse(res.body);
}

describe('delivery settings', () => {
  it('defaults to what the panel did before any of them existed', async () => {
    const s = await getSubscriptionSettings();
    expect(s.defaultFormat).toBe('plain');
    expect(s.linkShape).toBe('per-exit');
    expect(s.deadTexts).toBeNull();
    expect(s.publicHost).toBeNull();
  });

  it('round-trips the four writable ones', async () => {
    await put({
      subscriptionDefaultFormat: 'singbox',
      subscriptionLinkShape: 'per-node',
      subscriptionPublicHost: 'nw.example.com',
      subscriptionDeadTexts: { expired: { ru: 'Кончилась', en: 'Ran out' } },
    });
    const s = await getSubscriptionSettings();
    expect(s.defaultFormat).toBe('singbox');
    expect(s.linkShape).toBe('per-node');
    expect(s.publicHost).toBe('nw.example.com');
    expect(s.deadTexts?.expired?.ru).toBe('Кончилась');
    expect(s.deadTexts?.limited).toBeUndefined();
  });

  it('takes the scheme off a pasted URL instead of building https://https://', async () => {
    // Pasting the whole address is the expected mistake, not a malformed
    // request, so it is repaired on read rather than refused on write.
    await put({ subscriptionPublicHost: 'https://nw.example.com' });
    expect((await getSubscriptionSettings()).publicHost).toBe('nw.example.com');
  });

  it('refuses a host with a path, which would be a broken link on every device', async () => {
    await put({ subscriptionPublicHost: 'nw.example.com/sub' }, 400);
  });

  it('falls back on a hand-edited row rather than changing what subscribers get', async () => {
    // Straight into the table, the way a restored dump or a careless SQL
    // session would put it.
    for (const [key, value] of [
      ['subscriptionDefaultFormat', 'yaml-ish'],
      ['subscriptionLinkShape', 'per-continent'],
      ['subscriptionDeadTexts', 'not an object'],
    ] as const) {
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value: value as unknown as object, isPublic: false },
        update: { value: value as unknown as object },
      });
    }
    invalidateSubscriptionSettingsCache();
    const s = await getSubscriptionSettings();
    expect(s.defaultFormat).toBe('plain');
    expect(s.linkShape).toBe('per-exit');
    expect(s.deadTexts).toBeNull();
  });

  it('drops empty wording instead of rendering a blank line', async () => {
    await put({ subscriptionDeadTexts: { expired: { ru: '   ', en: '' }, limited: {} } });
    // Nothing usable in any of it, so the page keeps its own text.
    expect((await getSubscriptionSettings()).deadTexts).toBeNull();
  });

  it('serves the path prefix read-only, and says so', async () => {
    // The route is registered with this prefix at boot, so a value from the
    // database would not move the route: it would only make the panel
    // advertise an address nothing answers on.
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    const body = JSON.parse(res.body);
    expect(body.subscriptionPathPrefix).toBe('/sub');
    // Where it came from, not whether it may be edited: a boolean would read
    // as "sometimes you may", and the answer here is never.
    expect(body.subscriptionPathPrefixSource).toBe('env');
    // Writing it by name changes nothing: the key is not in the accepted set,
    // zod drops it, nothing is stored, and the next read still answers from
    // the environment. A 200 here means "your request was fine and contained
    // nothing I take", which is the honest answer for a field the screen is
    // not supposed to send at all.
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { subscriptionPathPrefix: '/x' },
    });
    expect(JSON.parse(bad.body).updated).not.toContain('subscriptionPathPrefix');
    const after = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(JSON.parse(after.body).subscriptionPathPrefix).toBe('/sub');
  });
});

describe('changing the address', () => {
  it('says how many live subscriptions it would break', async () => {
    // Shown BEFORE the host is changed. Every one of these people holds a link
    // built on the old host, and no redirect we control saves them: the old
    // name may stop resolving to us entirely. A number makes that concrete
    // where "this will break existing links" does not.
    const res = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(JSON.parse(res.body).subscriptionActiveCount).toBe(0);

    // Through the API rather than straight into the table: the row carries a
    // dozen generated credentials, and a test that hand-builds them is a test
    // that breaks the next time one is added.
    const made = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: { username: 'holder' },
    });
    expect(made.statusCode, made.body).toBe(201);
    const after = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(JSON.parse(after.body).subscriptionActiveCount).toBe(1);
  });
});

describe('one line per node', () => {
  // The collapsing rule, pinned on the pure function so the cases are legible
  // rather than buried in a fixture fleet.
  const ep = (nodeName: string, protocol: string, port: number) =>
    ({ nodeName, protocol, port, host: 'h', uri: `${protocol}://${nodeName}:${port}` }) as never;

  it('leaves a node that offers one thing alone', async () => {
    const { collapseToOneLinePerNode } = await import('../subscription/subscription.service.js');
    const out = collapseToOneLinePerNode([ep('fi-relay-1', 'hysteria', 443)]);
    // No xray appears out of nowhere: the preference order decides between
    // what is there, it does not invent.
    expect(out.map((e) => e.protocol)).toEqual(['hysteria']);
  });

  it('picks by the operator order when a node offers several', async () => {
    const { collapseToOneLinePerNode } = await import('../subscription/subscription.service.js');
    const out = collapseToOneLinePerNode([
      ep('nls-exit-2', 'shadowsocks', 8388),
      ep('nls-exit-2', 'hysteria', 443),
      ep('nls-exit-2', 'xray', 8443),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.protocol).toBe('xray');
  });

  it('settles a tie by the lower port, not by the order rows came back', async () => {
    const { collapseToOneLinePerNode } = await import('../subscription/subscription.service.js');
    const out = collapseToOneLinePerNode([
      ep('msk-entry-1', 'xray', 8443),
      ep('msk-entry-1', 'xray', 443),
    ]);
    expect(out[0]!.port).toBe(443);
  });

  it('keeps one line for every node, in the order they arrived', async () => {
    const { collapseToOneLinePerNode } = await import('../subscription/subscription.service.js');
    const out = collapseToOneLinePerNode([
      ep('a', 'hysteria', 443),
      ep('b', 'xray', 443),
      ep('a', 'xray', 443),
    ]);
    expect(out.map((e) => e.nodeName)).toEqual(['a', 'b']);
    expect(out[0]!.protocol).toBe('xray');
  });
});

describe('the preview link', () => {
  it('hands out a token that is not anybody, and expires', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/subscription/preview-url?state=expired',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const { url, expiresInSeconds } = JSON.parse(res.body);
    expect(expiresInSeconds).toBe(900);
    // Not a subscription address: a real token in an iframe means a real
    // subscriber's access in the browser history and in every proxy log.
    expect(url).not.toContain('/sub/');
    expect(url).toContain('/api/settings/subscription/preview/');

    const path = new URL(url).pathname;
    const page = await app.inject({ method: 'GET', url: path });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    // The invented user, and the state that was asked for.
    expect(page.body).toContain('preview');
    expect(page.body).toContain('Срок подписки закончился');
  });

  it('is dead once the token is unknown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/subscription/preview/6f1c2e7a-4b3d-4c9e-8a21-9d5f0b7e3c44',
    });
    expect(res.statusCode).toBe(404);
  });

  it('needs an admin to mint one', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/subscription/preview-url',
    });
    expect(res.statusCode).toBe(401);
  });
});
