import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { invalidateSubscriptionSettingsCache } from './settings.service.js';

/**
 * GET /api/settings answers about every writable key, set or not.
 *
 * It used to dump the rows that happened to exist, so a key nobody had saved
 * was absent from the object. The screen fell back to its defaults and looked
 * right, and "never set" and "cleared" arrived as the same thing: a missing
 * key is not an answer, and no screen can read one.
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

async function get(): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
}

/** The writable surface, as the screen knows it. Spelled out here on purpose:
 *  the route builds its list from the zod schema, and a test that read the same
 *  schema would pass whatever that schema became. */
const WRITABLE = [
  'brandName',
  'subscriptionProfileTitle',
  'subscriptionUpdateIntervalHours',
  'subscriptionSupportUrl',
  'subscriptionAnnounceTemplate',
  'subscriptionRoutingPreset',
  'subscriptionEntryPoolSize',
  'subscriptionTlsFragment',
  'subscriptionCustomRoutingRules',
  'subscriptionCustomDomainLists',
  'defaultLocale',
  'subscriptionDefaultFormat',
  'subscriptionLinkShape',
  'subscriptionDeadTexts',
  'subscriptionPublicHost',
];

describe('the settings response', () => {
  it('carries every writable key on a panel where nothing was ever saved', async () => {
    const body = await get();
    const missing = WRITABLE.filter((k) => !(k in body));
    expect(
      missing,
      `these keys are absent, so the screen cannot tell unset from cleared: ${missing.join(', ')}`,
    ).toEqual([]);
    for (const key of WRITABLE) {
      expect(body[key], key).toBeNull();
    }
  });

  it('keeps the read-only values beside them', async () => {
    // They are computed, not stored, and the screen shows them without an
    // editor. A null here would read as "not set" for something that always
    // has a value.
    const body = await get();
    expect(body.subscriptionPathPrefix).toBeTruthy();
    expect(body.subscriptionPathPrefixSource).toBe('env');
    expect(body.subscriptionActiveCount).toBe(0);
  });

  it('shows a saved value and leaves its neighbours null', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { subscriptionLinkShape: 'per-node' },
    });

    const body = await get();
    expect(body.subscriptionLinkShape).toBe('per-node');
    // The neighbour is still unanswered, and still says so.
    expect(body.subscriptionDefaultFormat).toBeNull();
  });

  it('says null again after a value is cleared', async () => {
    // The state the old shape could not express at all: set, then unset.
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { subscriptionPublicHost: 'nw.example.com' },
    });
    expect((await get()).subscriptionPublicHost).toBe('nw.example.com');

    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { subscriptionPublicHost: null },
    });
    expect((await get()).subscriptionPublicHost).toBeNull();
  });
});
