/**
 * The pin of the public recipe registry the panel ships a snapshot of, beside
 * core-versions.ts for the same reason: what the panel carries is named by an
 * exact revision and checked by content, never "whatever main says today".
 *
 *   repo         owner/repo on GitHub
 *   commit       the full commit sha the snapshot was built from
 *   indexSha256  sha256 of index.json at that commit, byte for byte
 *
 * Moving the pin: change commit and indexSha256 together, then run
 * `pnpm --filter @iceslab/panel-backend sync:recipes`, which fetches that
 * index.json, refuses it unless its sha256 matches, validates every recipe
 * with the recipe schema and writes recipes.snapshot.json beside this file.
 * Commit all three. recipes.snapshot.test.ts goes red on a pin moved without
 * its snapshot.
 */
export const RECIPES_REGISTRY = {
  repo: 'icecompany-tech/iceslab-recipes',
  commit: '41040599a29aae64924e52a2dc0d03cdb3c50173',
  indexSha256: '6bb6f6066eafbfe1ac423f8ecf00492f98ec99855f9c25b81446a96a9282a3c4',
} as const;

/** The raw URL of index.json at the pinned commit. */
export function recipesRegistryIndexUrl(pin: { repo: string; commit: string } = RECIPES_REGISTRY): string {
  return `https://raw.githubusercontent.com/${pin.repo}/${pin.commit}/index.json`;
}
