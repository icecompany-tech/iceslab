import { z } from 'zod';
import { RECIPE_SCHEMA_VERSION, type Recipe } from '@iceslab/shared';

/**
 * Server-side validation for a recipe pulled from the GitHub registry.
 *
 * Everything in the registry was PR-reviewed, but the panel still validates
 * every entry before serving it: a recipe is untrusted input crossing the
 * network, and a malformed one must be dropped rather than shipped to the
 * form. The schema strips unknown keys (forward-compatible with future
 * registry fields) and caps sizes so a hostile payload cannot bloat a
 * response. A recipe only ever sets ProfileForm field values, so `apply`
 * is constrained to primitive scalars with form-field-shaped keys.
 */

const RATING = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const RANDOMIZE = z.object({
  field: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'field must be a camelCase form-field name'),
  kind: z.enum(['token8', 'path', 'password16', 'awgHeader']),
});

// A single applied override value: string / number / boolean only. No
// objects, arrays, null: a recipe cannot inject structured data into the
// form, only scalar field values.
const APPLY_VALUE = z.union([z.string().max(512), z.number(), z.boolean()]);

// Common profile fields a recipe must never set: a recipe only tunes
// protocol-specific fields. Rejecting these here is defense-in-depth behind
// the frontend allowlist, so an untrusted recipe cannot flip a profile's
// protocol/engine or silently disable/rename it.
const RECIPE_COMMON_KEYS = ['protocol', 'engine', 'name', 'description', 'enabled'];

export const RecipeSchema = z.object({
  schemaVersion: z.number().int(),
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a lowercase slug'),
  protocol: z.string().min(1).max(32),
  emoji: z.string().min(1).max(8),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(200),
  details: z.string().min(1).max(2000),
  dpiResistance: RATING,
  speed: RATING,
  apply: z
    .record(
      z.string().min(1).max(48).regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
      APPLY_VALUE,
    )
    .refine((o) => Object.keys(o).length <= 40, 'too many apply keys')
    .refine(
      (o) => !RECIPE_COMMON_KEYS.some((k) => k in o),
      'apply may not set common profile fields (protocol/engine/name/description/enabled)',
    ),
  randomize: z.array(RANDOMIZE).max(16).optional(),
  notes: z.array(z.string().max(400)).max(16).optional(),
  region: z.enum(['GLOBAL', 'RU', 'IR', 'CN', 'BY', 'OTHER']).optional(),
  author: z.string().max(80).optional(),
  verified: z.boolean().optional(),
  minPanelVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'minPanelVersion must be semver')
    .optional(),
});

/**
 * The registry index the panel fetches. Top-level `recipes` array so the
 * file can carry its own schemaVersion and generation metadata. A bare
 * array is also accepted for a minimal hand-authored registry.
 */
export const RegistryIndexSchema = z.union([
  z.object({
    schemaVersion: z.number().int().optional(),
    recipes: z.array(z.unknown()),
  }),
  z.array(z.unknown()),
]);

/**
 * Validate one raw entry. Returns the typed Recipe or null (caller drops
 * nulls). Recipes on a schemaVersion the panel does not speak are rejected
 * here so a shape change never reaches the form half-parsed.
 */
export function parseRecipe(raw: unknown): Recipe | null {
  const res = RecipeSchema.safeParse(raw);
  if (!res.success) return null;
  if (res.data.schemaVersion !== RECIPE_SCHEMA_VERSION) return null;
  return res.data as Recipe;
}

// ───── Source management + ad-hoc import ─────
//
// URL length is capped here; scheme/host safety is enforced separately by
// assertFetchableUrl (recipes.ssrf.ts) at add/update and fetch time.

export const SourceInputSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
});

export const SourceUpdateSchema = SourceInputSchema.partial();

export const ImportRequestSchema = z.object({
  url: z.string().max(500).optional(),
  json: z.string().max(1_000_000).optional(),
});
