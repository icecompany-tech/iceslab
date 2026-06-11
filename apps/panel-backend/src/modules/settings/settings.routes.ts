import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { requireAuth } from '../auth/auth.hook.js';
import { prisma } from '../../prisma.js';

/**
 * Panel-wide settings (brand name, future feature flags). Two surfaces:
 *
 *   GET /api/settings/public   — no auth, returns public-flagged keys
 *                                only. LoginPage fetches this before the
 *                                user authenticates so the page can show
 *                                the right brand.
 *
 *   GET /api/settings          — requireAuth, returns ALL keys
 *   PUT /api/settings          — requireAuth, upsert keys
 *
 * Keys we use today:
 *   - `brandName` (string, public)                — title shown on LoginPage + sidebar
 *   - `subscriptionProfileTitle` (string)         — Profile-Title header on /sub
 *                                                   (NULL → fall back to brandName)
 *   - `subscriptionUpdateIntervalHours` (number)  — Profile-Update-Interval header,
 *                                                   default 24
 *   - `subscriptionSupportUrl` (string)           — Support-URL header + announce
 *                                                   {{SUPPORT_URL}} placeholder
 *   - `subscriptionAnnounceTemplate` (string)     — Announce header template,
 *                                                   placeholders: {{TRAFFIC_LEFT}},
 *                                                   {{DAYS_LEFT}}, {{SUPPORT_URL}}
 *   - `subscriptionRoutingPreset` (enum, R1a)     - routing rules emitted into
 *                                                   clash/singbox/xrayjson:
 *                                                   'proxy-all' (default) |
 *                                                   'ru-split'
 *
 * Future keys land in the same table; flip `isPublic` per key.
 */

const PUBLIC_KEYS = new Set(['brandName']);

const UpsertInput = z.object({
  brandName: z.string().min(1).max(64).optional(),
  subscriptionProfileTitle: z.string().min(1).max(128).nullable().optional(),
  subscriptionUpdateIntervalHours: z.number().int().min(1).max(168).optional(),
  subscriptionSupportUrl: z.string().url().max(255).nullable().optional(),
  subscriptionAnnounceTemplate: z.string().max(512).nullable().optional(),
  subscriptionRoutingPreset: z.enum(ROUTING_PRESET_IDS).optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/public', async (_req, reply) => {
    const rows = await prisma.appSetting.findMany({
      where: { isPublic: true },
    });
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return reply.send(out);
  });

  app.register(async (admin) => {
    admin.addHook('onRequest', requireAuth);

    admin.get('/api/settings', async (_req, reply) => {
      const rows = await prisma.appSetting.findMany();
      const out: Record<string, unknown> = {};
      for (const r of rows) out[r.key] = r.value;
      return reply.send(out);
    });

    admin.put('/api/settings', async (req, reply) => {
      const input = UpsertInput.parse(req.body);
      const entries = Object.entries(input).filter(([, v]) => v !== undefined);
      for (const [key, value] of entries) {
        // Prisma's `Json` column accepts any JSON-serialisable value at the
        // SQL layer, but the TS surface insists on `Prisma.InputJsonValue`.
        // Strings ARE valid JSON, so the cast is sound — TS just refuses
        // string→object without the explicit `unknown` step.
        const jsonValue = value as unknown as object;
        await prisma.appSetting.upsert({
          where: { key },
          create: { key, value: jsonValue, isPublic: PUBLIC_KEYS.has(key) },
          update: { value: jsonValue },
        });
      }
      return reply.send({ ok: true, updated: entries.map(([k]) => k) });
    });
  });
}
