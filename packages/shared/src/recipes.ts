/**
 * Transport-recipe wire contract, shared by the panel backend (registry
 * fetch + validation) and the frontend (RecipePicker apply).
 *
 * A recipe is DATA, not code: it is a named preset that fills a known-good
 * combination of protocol-specific ProfileForm fields. Importing one can
 * only set values the operator could type by hand, and the created profile
 * still goes through the same server-side validation. There is no code
 * execution and no URL the recipe can make the panel fetch.
 *
 * Built-in recipes (frontend lib/recipes.ts) and community recipes pulled
 * from the GitHub registry share this exact shape, so the RecipePicker
 * renders and applies both through one path.
 */

/** Bumped when the recipe shape changes in a non-backward-compatible way. */
export const RECIPE_SCHEMA_VERSION = 1;

/**
 * Field-level randomisation applied at click-time so a static preset does
 * not fingerprint every deployment identically. Declarative (not a JS
 * thunk) so a recipe stays JSON-serialisable and portable through the
 * registry. The frontend resolves each entry when the recipe is applied.
 *
 * - `token8`      8-char base36 token (e.g. gRPC serviceName).
 * - `path`        leading-slash URL path with an 8-char base36 tail (xhttp).
 * - `password16`  16-char base36 secret (e.g. Salamander obfs password).
 * - `awgHeader`   random int32 in the AmneziaWG H1-H4 magic-byte range.
 */
export type RecipeRandomizeKind = 'token8' | 'path' | 'password16' | 'awgHeader';

export interface RecipeRandomize {
  /** ProfileForm field the resolved value is written into. */
  field: string;
  kind: RecipeRandomizeKind;
}

/** 1-5 subjective rating (DPI-resistance / throughput). */
export type RecipeRating = 1 | 2 | 3 | 4 | 5;

/**
 * Coarse region tag for filtering. GLOBAL means "no region-specific
 * tuning". Free-form is tolerated by the validator but these are the
 * curated set shown as filter chips.
 */
export type RecipeRegion = 'GLOBAL' | 'RU' | 'IR' | 'CN' | 'BY' | 'OTHER';

export interface Recipe {
  /** Must equal RECIPE_SCHEMA_VERSION; older/newer recipes are skipped. */
  schemaVersion: number;
  /** Stable slug, unique within the registry. Also the i18n override key. */
  id: string;
  /** Which protocol this recipe configures (a ProtocolName). */
  protocol: string;
  /** Single emoji shown in the card chip. */
  emoji: string;
  /** Card title, short and intent-driven. */
  name: string;
  /** One-line subtitle: when to pick this. */
  description: string;
  /** Long-form explanation shown when the card is selected. */
  details: string;
  dpiResistance: RecipeRating;
  speed: RecipeRating;
  /**
   * Field overrides merged into the ProfileForm on apply. Values are
   * primitives only. The frontend drops any key that is not an actual form
   * field, so an unknown key is inert; the created profile is still
   * validated server-side on save.
   */
  apply: Record<string, string | number | boolean>;
  /** Fields randomised at click-time. Resolved values win over `apply`. */
  randomize?: RecipeRandomize[];
  /** Sanity notes shown after apply. */
  notes?: string[];
  /** Region tag for the registry filter. Absent means GLOBAL. */
  region?: RecipeRegion;
  /** Attribution shown as a byline on registry cards. */
  author?: string;
  /**
   * Whether the recipe sits in the registry's curated/official set. Stamped
   * by the registry's own CI from the source folder, NOT self-declared, so a
   * community submission cannot mark itself verified. Informational badge
   * only: everything in the registry was PR-reviewed regardless.
   */
  verified?: boolean;
  /**
   * Minimum panel version (semver) this recipe needs. The backend hides
   * recipes the running panel is older than so a recipe never references a
   * protocol option the panel does not have yet.
   */
  minPanelVersion?: string;
  /**
   * Name of the source this recipe was merged from. Stamped by the backend
   * when it aggregates the operator's enabled sources, so a card can show
   * where a recipe came from. Absent on built-ins.
   */
  sourceName?: string;
  /** Id of the source (backend-stamped) for grouping and filtering. */
  sourceId?: string;
}

/**
 * Response of `GET /api/recipes/registry`. The backend fetches the registry
 * index from GitHub, validates every entry against the recipe schema, drops
 * invalid/too-new ones, caches the result, and returns what survived.
 */
export interface RecipeRegistryResponse {
  /** ISO timestamp of the backend's last successful registry fetch. */
  fetchedAt: string;
  /** `owner/repo@ref` the recipes were read from. */
  source: string;
  /** Recipes that passed validation and the version gate. */
  recipes: Recipe[];
  /**
   * True when the last fetch failed and these recipes are a stale cache (or
   * empty). Lets the UI show a "registry offline" hint without erroring.
   */
  stale: boolean;
}

/**
 * A configured recipe source (operator-managed, "bring your own GitHub").
 * The panel merges recipes from every enabled source; the seeded default
 * points at the curated icecompany-tech/iceslab-recipes registry.
 */
export interface RecipeSource {
  id: string;
  name: string;
  /** Raw URL of a registry index.json or a recipes JSON array. */
  url: string;
  enabled: boolean;
  /** True for the seeded default source. Informational, not a trust gate. */
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload to create or update a recipe source. */
export interface RecipeSourceInput {
  name: string;
  url: string;
  enabled?: boolean;
}

/**
 * Ad-hoc import: pull recipes from a one-off URL or validate pasted JSON
 * without adding a permanent source. Exactly one of `url` / `json` is used.
 */
export interface RecipeImportRequest {
  url?: string;
  json?: string;
}

/** Result of an ad-hoc import: the recipes that passed validation. */
export interface RecipeImportResponse {
  recipes: Recipe[];
}
