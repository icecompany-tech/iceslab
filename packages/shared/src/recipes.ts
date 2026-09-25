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
 * The panel ships no recipes of its own (owner's decision 25.09). The public
 * registry, icecompany-tech/iceslab-recipes, is the one source: the panel
 * carries a snapshot of it pinned by commit (RECIPES_REGISTRY in
 * recipes-registry.ts, the file recipes.snapshot.json beside it), the
 * operator's sources are fetched over it, and every recipe, from wherever,
 * has this one shape.
 */

/**
 * Bumped when the recipe shape changes in a non-backward-compatible way.
 * 2 (25.09): a recipe says its engine, protocol and, for xray, subprotocol,
 * the three a profile has, instead of a panel card. 1 is not read any more.
 */
export const RECIPE_SCHEMA_VERSION = 2;

/** The core that runs a recipe's protocol: its own, or sing-box. */
export const RECIPE_ENGINES = ['native', 'singbox'] as const;
export type RecipeEngine = (typeof RECIPE_ENGINES)[number];

/**
 * The wire protocols xray serves, one of which every xray recipe names: the
 * screen derives the recipe's tile from (protocol, engine, subprotocol), the
 * same way it does for a profile. No other protocol takes a subprotocol.
 */
export const RECIPE_XRAY_SUBPROTOCOLS = ['vless', 'vmess', 'trojan', 'socks', 'http'] as const;
export type RecipeXraySubprotocol = (typeof RECIPE_XRAY_SUBPROTOCOLS)[number];

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
  /** The core that runs it. */
  engine: RecipeEngine;
  /**
   * Which protocol this recipe configures. A plain string, not ProtocolName:
   * the registry may carry a protocol the screen draws before the backend
   * serves it (telegramweb); whether it is known is the screen's check.
   */
  protocol: string;
  /** Required on xray, absent on every other protocol. When `apply` sets
   *  `xraySubprotocol`, it equals this. */
  subprotocol?: RecipeXraySubprotocol;
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
   * when it merges, so a card can show where a recipe came from.
   */
  sourceName?: string;
  /**
   * Id of the source (backend-stamped): an operator source's id, or
   * RECIPE_SOURCE_BUILTIN for the pinned snapshot.
   */
  sourceId?: string;
  /**
   * The other sources that carry a recipe with this id, by name. The server
   * serves one recipe per id (the winner: the operator's sources in the order
   * of their list, then the snapshot) and names the ones it set aside here, so
   * the screen merges nothing.
   */
  alsoIn?: string[];
}

/** The `sourceId` (and `sourceName`) of a recipe from the pinned snapshot. */
export const RECIPE_SOURCE_BUILTIN = 'builtin';

/**
 * The pinned snapshot the panel ships (packages/shared/src/recipes.snapshot.json),
 * written by `pnpm --filter @iceslab/panel-backend sync:recipes` from
 * RECIPES_REGISTRY and never by hand.
 */
export interface RecipeSnapshot {
  /** `owner/repo`, commit and the sha256 of its index.json: the pin it was built from. */
  repo: string;
  commit: string;
  indexSha256: string;
  /** Every recipe of that index, as the recipe schema reads it. */
  recipes: Recipe[];
}

/**
 * Response of `GET /api/recipes/registry`. The backend serves the pinned
 * snapshot, fetches the operator's sources over it, validates every entry
 * against the recipe schema, drops invalid/too-new ones, caches the result,
 * and returns one recipe per id.
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
  /**
   * Every enabled source and how its last fetch went, so the screen can say
   * WHICH source failed and WHY instead of one "offline" for all of them.
   */
  sources: RecipeSourceStatus[];
}

/**
 * Why a source's last fetch failed, in the words the screen translates:
 *   not-found    the address answered 404: the file or the repository is not
 *                there (a repository that was never created looks like this);
 *   unreachable  no answer, a timeout, a 5xx or another refusal: try later;
 *   invalid      it answered, and what came back is not a recipe list (not
 *                JSON, over the size cap, a redirect loop, an address the
 *                guard refuses).
 */
export type RecipeSourceProblem = 'not-found' | 'unreachable' | 'invalid';

export interface RecipeSourceStatus {
  id: string;
  name: string;
  /** The most recent fetch succeeded. */
  ok: boolean;
  /** Set exactly when `ok` is false. */
  reason?: RecipeSourceProblem;
  /** The HTTP status the source answered with, when it answered at all. */
  httpStatus?: number;
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
