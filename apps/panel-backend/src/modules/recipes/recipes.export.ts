import {
  RECIPE_SCHEMA_VERSION,
  RECIPE_XRAY_SUBPROTOCOLS,
  type Recipe,
  type RecipeRandomize,
  type RecipeRandomizeKind,
  type RecipeXraySubprotocol,
} from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { effectiveEngineOf } from '../nodes/node-engines.js';
import { RecipeSchema } from './recipes.schemas.js';
import { getRecipeSnapshot } from './recipes.snapshot.js';

/**
 * A profile as a registry recipe (schema v2): what the operator puts in a pull
 * request to icecompany-tech/iceslab-recipes (25.09).
 *
 * `apply` holds form fields, not config keys: a recipe fills the profile form.
 * Which fields, per protocol, is the same allowlist the registry's own recipes
 * set (their `apply` keys and `randomize` fields, read off the pinned
 * snapshot), so an export never carries a field no recipe carries: no key, no
 * certificate, no name. A field the registry randomises (an obfs password, a
 * gRPC service name, the AmneziaWG headers) goes out as a `randomize` entry of
 * the same kind, never as this profile's value: the value is a secret or a
 * fingerprint of this deployment.
 */

type Cfg = Record<string, unknown>;
type FieldValue = string | number | boolean | undefined;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const list = (v: unknown): string | undefined =>
  Array.isArray(v) && v.length > 0 ? v.filter((x) => typeof x === 'string').join(', ') : undefined;
const obf = (cfg: Cfg, k: string) => num((cfg.obfuscation as Cfg | undefined)?.[k]);

/**
 * Form field -> its value in a profile's config, as the profile form reads it
 * (panel-frontend profileDefaults.ts, formFromProfile). Only the fields the
 * allowlist can name; recipes.export.test.ts holds this table to the
 * allowlist, so a field the registry starts setting cannot be dropped here
 * without a red test.
 */
const FROM_CONFIG: Record<string, (cfg: Cfg) => FieldValue> = {
  // hysteria
  hyObfsPassword: (c) => str(c.obfsPassword),
  hyMasqueradeUrl: (c) => str(c.masqueradeUrl),
  hyBrutalUp: (c) => num(c.brutalUpMbps),
  hyBrutalDown: (c) => num(c.brutalDownMbps),
  hyPortHopStart: (c) => num(c.portHoppingStart),
  hyPortHopEnd: (c) => num(c.portHoppingEnd),
  // xray
  xraySubprotocol: (c) => str(c.subprotocol) ?? 'vless',
  xraySecurity: (c) => str(c.security),
  xrayFlow: (c) => str(c.flow),
  xrayNetwork: (c) => str(c.network),
  xrayDest: (c) => str(c.realityDest),
  xrayServerNames: (c) => list(c.realityServerNames),
  xrayFingerprint: (c) => str(c.fingerprint),
  xrayServiceName: (c) => str(c.serviceName),
  xrayPath: (c) => str(c.path),
  // amneziawg: a profile read into the form is always the custom preset
  awgPreset: () => 'custom',
  awgSubnet: (c) => str(c.subnet),
  awgJc: (c) => obf(c, 'jc'),
  awgJmin: (c) => obf(c, 'jmin'),
  awgJmax: (c) => obf(c, 'jmax'),
  awgS1: (c) => obf(c, 's1'),
  awgS2: (c) => obf(c, 's2'),
  awgS3: (c) => obf(c, 's3'),
  awgS4: (c) => obf(c, 's4'),
  awgH1: (c) => obf(c, 'h1'),
  awgH2: (c) => obf(c, 'h2'),
  awgH3: (c) => obf(c, 'h3'),
  awgH4: (c) => obf(c, 'h4'),
  // the rest, one or two fields each
  naiveMasquerade: (c) => str(c.masqueradeRoot),
  ssMethod: (c) => str(c.method),
  mtgDomain: (c) => str(c.domain),
  mieruMtu: (c) => num(c.mtu),
  tuicCongestion: (c) => str(c.congestionControl),
  anytlsServerName: (c) => str(c.serverName),
  shadowtlsHandshake: (c) => str(c.handshake),
  shadowtlsSsMethod: (c) => str(c.ssMethod),
};

/** The form fields an export can read off a profile. */
export const EXPORTABLE_FIELDS: ReadonlySet<string> = new Set(Object.keys(FROM_CONFIG));

export interface RecipeAllowlist {
  /** Per protocol, the form fields a recipe may carry. */
  fields: Map<string, Set<string>>;
  /** The fields the registry randomises, and how. */
  randomized: Map<string, RecipeRandomizeKind>;
}

/** The allowlist, read off the registry's recipes in the pinned snapshot. */
export function recipeAllowlist(recipes: readonly Recipe[] = getRecipeSnapshot().recipes): RecipeAllowlist {
  const fields = new Map<string, Set<string>>();
  const randomized = new Map<string, RecipeRandomizeKind>();
  for (const r of recipes) {
    const set = fields.get(r.protocol) ?? new Set<string>();
    for (const k of Object.keys(r.apply)) set.add(k);
    for (const rz of r.randomize ?? []) {
      set.add(rz.field);
      randomized.set(rz.field, rz.kind);
    }
    fields.set(r.protocol, set);
  }
  return { fields, randomized };
}

/** A lowercase slug of the profile's name, the recipe id the registry takes. */
export function recipeIdOf(name: string, profileId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return /^[a-z0-9]/.test(slug) ? slug : `profile-${profileId.slice(0, 8)}`;
}

export function profileToRecipe(
  profile: { id: string; name: string; description: string | null; protocol: string; engine: string | null; config: unknown },
  allow: RecipeAllowlist = recipeAllowlist(),
): Recipe {
  const cfg = (profile.config ?? {}) as Cfg;
  const apply: Record<string, string | number | boolean> = {};
  const randomize: RecipeRandomize[] = [];
  for (const field of allow.fields.get(profile.protocol) ?? []) {
    const value = FROM_CONFIG[field]?.(cfg);
    if (value === undefined) continue;
    const kind = allow.randomized.get(field);
    // The profile HAS the value, and the registry draws it at click time:
    // out goes the draw, never this deployment's value.
    if (kind) randomize.push({ field, kind });
    else apply[field] = value;
  }
  const engine = effectiveEngineOf(profile) === 'singbox' ? 'singbox' : 'native';
  const sub = str(cfg.subprotocol) ?? 'vless';
  const subprotocol =
    profile.protocol === 'xray' && (RECIPE_XRAY_SUBPROTOCOLS as readonly string[]).includes(sub)
      ? (sub as RecipeXraySubprotocol)
      : undefined;
  const description = profile.description?.trim() || profile.name;
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: recipeIdOf(profile.name, profile.id),
    engine,
    protocol: profile.protocol,
    ...(subprotocol ? { subprotocol } : {}),
    emoji: '⭐',
    name: profile.name.slice(0, 80),
    description: description.slice(0, 200),
    details: description.slice(0, 2000),
    // A starting point the author sets before the pull request: the panel
    // cannot measure either.
    dpiResistance: 3,
    speed: 3,
    apply,
    ...(randomize.length > 0 ? { randomize } : {}),
  };
}

/** GET /api/profiles/:id/recipe: null when there is no such profile. */
export async function exportProfileRecipe(id: string): Promise<Recipe | null> {
  const profile = await prisma.profile.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, protocol: true, engine: true, config: true },
  });
  if (!profile) return null;
  const recipe = profileToRecipe(profile);
  // What goes out must be what the registry and the import take back.
  return RecipeSchema.parse(recipe) as Recipe;
}
