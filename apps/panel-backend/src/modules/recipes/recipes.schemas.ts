import { z } from 'zod';
import {
  RECIPE_ENGINES,
  RECIPE_SCHEMA_VERSION,
  RECIPE_XRAY_SUBPROTOCOLS,
  type Recipe,
} from '@iceslab/shared';

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

/**
 * Schema v2 (25.09): a recipe says the three things a profile has, engine,
 * protocol and (for xray) subprotocol, and the screen derives its tile from
 * them. `schemaVersion` stays a plain int here so a v1 recipe PARSES and is
 * then refused by name (parseRecipe), not lost in a shape error.
 *
 * This object is also what recipe.schema.json is generated from
 * (recipes.json-schema.ts), which the registry validates its files with. The
 * cross-field rules below (superRefine) have no JSON Schema form and the
 * registry's own build keeps them.
 */
const RecipeObject = z.object({
  schemaVersion: z.number().int(),
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a lowercase slug'),
  engine: z.enum(RECIPE_ENGINES),
  // A string, not ProtocolName: the registry may carry a protocol the screen
  // draws before the backend serves it (telegramweb).
  protocol: z.string().min(1).max(32),
  subprotocol: z.enum(RECIPE_XRAY_SUBPROTOCOLS).optional(),
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

export { RecipeObject };

export const RecipeSchema = RecipeObject.superRefine((r, ctx) => {
  if (r.protocol === 'xray') {
    // The tile of an xray recipe is (xray, engine, subprotocol): without it
    // the screen cannot tell vless from a Telegram socks proxy.
    if (r.subprotocol === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subprotocol'],
        message: `an xray recipe names its subprotocol: ${RECIPE_XRAY_SUBPROTOCOLS.join(', ')}`,
      });
    } else if (r.apply.xraySubprotocol !== undefined && r.apply.xraySubprotocol !== r.subprotocol) {
      ctx.addIssue({
        code: 'custom',
        path: ['apply', 'xraySubprotocol'],
        message: `apply.xraySubprotocol "${String(r.apply.xraySubprotocol)}" contradicts subprotocol "${r.subprotocol}"`,
      });
    }
  } else if (r.subprotocol !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['subprotocol'],
      message: `only an xray recipe takes a subprotocol, and this one is ${r.protocol}`,
    });
  }
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
