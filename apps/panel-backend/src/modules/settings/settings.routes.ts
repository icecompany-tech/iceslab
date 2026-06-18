import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { requireAuth } from '../auth/auth.hook.js';
import { prisma } from '../../prisma.js';
import { invalidateSubscriptionSettingsCache } from './settings.service.js';

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
 *   - `subscriptionRoutingPreset` (enum, R1a + H2) - routing rules emitted into
 *                                                   clash/singbox/xrayjson:
 *                                                   'proxy-all' (default) |
 *                                                   'ru-split' | 'cn-split'
 *   - `subscriptionTlsFragment` (boolean)         - when true, the Xray JSON
 *                                                   format splits the client's
 *                                                   outgoing ClientHello via a
 *                                                   freedom `fragment` outbound
 *                                                   so SNI-based DPI cannot
 *                                                   cleanly match the handshake.
 *                                                   Default false. Xray JSON only.
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
  // TLS-fragment - split the client's outgoing ClientHello so SNI-based DPI
  // (RU TSPU / RKN) cannot cleanly match the handshake. Xray JSON format only.
  subscriptionTlsFragment: z.boolean().optional(),
  // R3-b - raw custom xray routing rules (array of rule objects), or null to
  // clear. Applied to xray/xkeen subscription output ahead of the preset.
  subscriptionCustomRoutingRules: z
    .array(z.record(z.string(), z.unknown()))
    .max(50)
    .nullable()
    .optional(),
  // R3 - operator-defined custom domain lists (direct/proxy/block), or null to
  // clear. Emitted into xray/xkeen + clash routing rules ahead of the preset.
  subscriptionCustomDomainLists: z
    .object({
      direct: z.array(z.string().min(1).max(253)).max(500).optional(),
      proxy: z.array(z.string().min(1).max(253)).max(500).optional(),
      block: z.array(z.string().min(1).max(253)).max(500).optional(),
    })
    .nullable()
    .optional(),
  // Subscription landing-page default language. The panel's LanguageSwitcher
  // mirrors its UI language here so the human /sub page defaults to the same
  // language the operator runs the panel in. The page also carries an in-page
  // RU/EN selector (?lang=) that overrides per visitor, so this is the default,
  // not a hard lock.
  defaultLocale: z.enum(['ru', 'en']).optional(),
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
      // B5 - bust the /sub settings cache so admin changes take effect now.
      invalidateSubscriptionSettingsCache();
      return reply.send({ ok: true, updated: entries.map(([k]) => k) });
    });
  });
}
