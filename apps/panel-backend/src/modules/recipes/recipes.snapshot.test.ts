import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECIPES_REGISTRY, recipesRegistryIndexUrl, type RecipeSnapshot } from '@iceslab/shared';
import { RecipeSchema } from './recipes.schemas.js';
import {
  RecipeSnapshotError,
  buildRecipeSnapshot,
  recipeSnapshotPath,
  serializeRecipeSnapshot,
  sha256Hex,
} from './recipes.snapshot.js';
import { recipeJsonSchemaPath, serializeRecipeJsonSchema } from './recipes.json-schema.js';

/**
 * The pinned snapshot of the public registry (25.09: the panel ships no
 * recipes of its own). Guards: the committed file is the build of the pin
 * (by content here, over the network in CI), it holds the 22 recipes the
 * registry had at that commit, and recipe.schema.json is the generation of
 * the schema the panel parses with.
 */
const text = readFileSync(recipeSnapshotPath(), 'utf8');
const snapshot = JSON.parse(text) as RecipeSnapshot;

describe('the committed snapshot', () => {
  it('is the build of the pin: a pin moved without its snapshot is red', () => {
    expect({ repo: snapshot.repo, commit: snapshot.commit, indexSha256: snapshot.indexSha256 }).toEqual(RECIPES_REGISTRY);
    // Written by the build, not by hand: the bytes are its serialization.
    expect(text).toBe(serializeRecipeSnapshot(snapshot));
  });

  it('parses whole: 22 recipes, the WEB tile among them', () => {
    expect(snapshot.recipes).toHaveLength(22);
    expect(snapshot.recipes.map((r) => r.id)).toContain('telegram-web-tproxy-websocket');
    expect(new Set(snapshot.recipes.map((r) => r.id)).size).toBe(22);
  });

  it('every recipe passes the schema: engine, protocol, and a subprotocol exactly on xray', () => {
    for (const r of snapshot.recipes) {
      const res = RecipeSchema.safeParse(r);
      expect(res.success, `${r.id}: ${res.success ? '' : res.error.issues[0]?.message}`).toBe(true);
      expect(['native', 'singbox']).toContain(r.engine);
      expect(r.subprotocol !== undefined, r.id).toBe(r.protocol === 'xray');
    }
  });

  it.runIf(process.env.CI === 'true')('equals a fresh build from the pinned commit (network, CI)', async () => {
    const res = await fetch(recipesRegistryIndexUrl(RECIPES_REGISTRY));
    expect(res.status).toBe(200);
    const built = buildRecipeSnapshot(new Uint8Array(await res.arrayBuffer()));
    expect(serializeRecipeSnapshot(built)).toBe(text);
  });
});

describe('buildRecipeSnapshot', () => {
  const pinFor = (bytes: Uint8Array) => ({ repo: 'o/r', commit: 'c'.repeat(40), indexSha256: sha256Hex(bytes) });
  const index = (recipes: unknown[]) => new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, recipes }));

  it('refuses an index whose sha256 is not the pinned one', () => {
    const bytes = index([]);
    expect(() => buildRecipeSnapshot(bytes, { ...pinFor(bytes), indexSha256: '0'.repeat(64) })).toThrow(
      /has sha256 [0-9a-f]{64}, the pin says 0{64}/,
    );
  });

  it('refuses the whole build on one bad recipe, naming it, instead of shipping without it', () => {
    const good = snapshot.recipes[0]!;
    const bytes = index([good, { ...good, id: 'broken', engine: 'xray' }]);
    expect(() => buildRecipeSnapshot(bytes, pinFor(bytes))).toThrow(RecipeSnapshotError);
    expect(() => buildRecipeSnapshot(bytes, pinFor(bytes))).toThrow(/recipe broken: engine/);
    const v1 = index([{ ...good, schemaVersion: 1 }]);
    expect(() => buildRecipeSnapshot(v1, pinFor(v1))).toThrow(/schemaVersion 1, the panel reads 2/);
  });
});

describe('recipe.schema.json', () => {
  it('equals a fresh generation from the schema the panel parses with', () => {
    expect(readFileSync(recipeJsonSchemaPath(), 'utf8')).toBe(serializeRecipeJsonSchema());
  });
});
