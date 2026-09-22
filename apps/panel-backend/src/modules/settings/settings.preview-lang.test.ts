import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { invalidateSubscriptionSettingsCache } from './settings.service.js';

/**
 * The preview answers about the language it is asked for.
 *
 * The delivery screen lets an operator write the dead-state texts in BOTH
 * languages, and the preview built the page from the panel default alone. So
 * half of what they had just written could not be looked at: they would write
 * the English text, press preview, and see the Russian page. The real page has
 * taken `?lang=` since it was built, and a preview that behaves differently is
 * a preview of something else.
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

async function previewUrl(query: string): Promise<string> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/settings/subscription/preview-url${query}`,
    headers: auth(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body).url as string;
}

/** The preview page itself is public by its token, so no headers here: that is
 *  how an iframe reaches it. */
async function previewPage(url: string): Promise<string> {
  const path = url.slice(url.indexOf('/api/settings'));
  const res = await app.inject({ method: 'GET', url: path });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.body;
}

describe('the subscription preview', () => {
  it('builds the page in the language the operator asked for', async () => {
    // The panel default is Russian here, and English is asked for anyway.
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { defaultLocale: 'ru' },
    });
    invalidateSubscriptionSettingsCache();

    const en = await previewPage(await previewUrl('?lang=en'));
    expect(en).toContain('<html lang="en"');

    const ru = await previewPage(await previewUrl('?lang=ru'));
    expect(ru).toContain('<html lang="ru"');
  });

  it('puts the language in the url, so the iframe can switch it', async () => {
    const url = await previewUrl('?lang=en&state=expired');
    expect(url).toContain('?lang=en');

    // And the page's own RU/EN footer links work inside the preview: they are
    // plain `?lang=` hrefs, so this is the same mechanism, not a second one.
    const switched = await previewPage(`${url.split('?')[0]}?lang=ru`);
    expect(switched).toContain('<html lang="ru"');
  });

  it('falls back to the panel default when nothing is asked for', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: { defaultLocale: 'en' },
    });
    invalidateSubscriptionSettingsCache();

    const page = await previewPage(await previewUrl(''));
    expect(page).toContain('<html lang="en"');
  });

  it('shows the operator their own dead text, in the language they wrote it', async () => {
    // The case the whole fix is for: two texts on one screen, one preview.
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: auth(),
      payload: {
        defaultLocale: 'ru',
        subscriptionDeadTexts: {
          expired: { ru: 'Подписка кончилась', en: 'Your subscription ran out' },
        },
      },
    });
    invalidateSubscriptionSettingsCache();

    const ru = await previewPage(await previewUrl('?lang=ru&state=expired'));
    expect(ru).toContain('Подписка кончилась');

    const en = await previewPage(await previewUrl('?lang=en&state=expired'));
    expect(en).toContain('Your subscription ran out');
  });
});
