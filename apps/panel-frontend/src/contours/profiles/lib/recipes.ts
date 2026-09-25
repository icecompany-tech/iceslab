/**
 * Transport Recipes, pre-validated config presets for the ProfileFormModal.
 *
 * Each recipe is a one-click "I want to achieve X" choice that fills in a
 * known-good combination of fields. Lets new admins configure DPI-resistant
 * transports without learning every protocol's quirks.
 *
 * Why this exists instead of raw form fields sorted alphabetically: recipes
 * are grouped by intent ("max stealth" / "CDN-friendly" / "RU-mobile-tuned")
 * and self-validate combos that xray-core silently rejects (REALITY+ws is the
 * canonical example, looks fine in the form, dies on `xray run` with
 * `REALITY only supports RAW, XHTTP and gRPC`).
 *
 * Recipes only touch protocol-specific fields. Common fields (name,
 * description, enabled) are left to the user.
 */

import type { ProtocolName } from '@/lib/domain/protocols';
import { profileKindKey, type PreviewKindKey } from '@/contours/profiles/lib/profileKinds';
import { RECIPE_SCHEMA_VERSION, RECIPE_SOURCE_BUILTIN, RECIPE_SOURCE_MINE } from '@iceslab/shared';
import snapshot from '@iceslab/shared/recipes.snapshot.json';
import type {
  Recipe as WireRecipe,
  RecipeEngine,
  RecipeRandomize,
  RecipeRandomizeKind,
  RecipeSaved,
  RecipeSnapshot,
  RecipeSourceProblem,
  RecipeSourceStatus,
} from '@iceslab/shared';

/** What a recipe configures: a protocol, or a view the panel draws ahead of
 *  its backend (WEB), whose recipe fills the view's draft and nothing else. */
export type RecipeProtocol = ProtocolName | PreviewKindKey;

export interface Recipe {
  id: string;
  protocol: RecipeProtocol;
  /**
   * Which core runs the recipe (schema v2): the protocol's own (`native`) or
   * sing-box. Absent reads as `native`, which is every v1 recipe. With
   * `protocol` and `subprotocol` it decides the tile (recipeTile), the same
   * way a saved profile finds its tile; the recipe does not name its tile.
   */
  engine?: RecipeEngine;
  /** `socks` or `http` for the two xray subprotocols that have tiles of their
   *  own (Telegram SOCKS5 and HTTP); absent everywhere else. */
  subprotocol?: string;
  /** Single emoji in the chip, pick from a tight palette for visual variety. */
  emoji: string;
  /** Card title, short, direct, intent-driven. */
  name: string;
  /** One-line subtitle explaining when to pick this. */
  description: string;
  /**
   * 1-5 stars: subjective DPI-resistance rating. Vision+REALITY is the
   * gold standard at 5; plain TLS is 2; obfs-augmented protocols at 4-5.
   */
  dpiResistance: 1 | 2 | 3 | 4 | 5;
  /**
   * 1-5 stars: throughput rating. Raw TCP+Vision is fastest at 5; HTTP/2
   * chunked transports lose ~10-20% to framing; UDP-based wins on RTT.
   */
  speed: 1 | 2 | 3 | 4 | 5;
  /** Long-form description shown when card is selected. */
  details: string;
  /**
   * Field overrides applied on click. Keyed loosely, the form merges
   * these into existing values. Only protocol-specific fields belong here.
   * Per-click randomness (Salamander password, AmneziaWG H1-H4, xhttp path)
   * is the declarative `randomize` list, resolved at click time.
   */
  apply: Record<string, string | number | boolean>;
  /**
   * Sanity warnings tied to this recipe. Empty array if pristine. Shown
   * as info banners after apply.
   */
  notes?: string[];
  /**
   * Declarative click-time randomisation. Resolved values win over the
   * matching `apply` key.
   */
  randomize?: RecipeRandomize[];
  // ───── Registry metadata ─────
  schemaVersion?: number;
  /** Region tag driving the registry filter chips. Absent means GLOBAL. */
  region?: string;
  /** Byline shown on registry cards. */
  author?: string;
  /** Curated/official flag stamped by the registry CI (informational badge). */
  verified?: boolean;
  /** Minimum panel semver; the backend hides recipes newer panels than ours. */
  minPanelVersion?: string;
  /** Source this recipe was merged from (backend-stamped); absent on built-ins. */
  sourceName?: string;
  sourceId?: string;
  /** Provenance, from `sourceId`: `builtin` is the panel's pinned snapshot
   *  of the registry, `mine` the operator's own (saved from an import),
   *  `registry` any other source. */
  source?: 'builtin' | 'registry' | 'mine';
  /** Other sources that carry this id (server-merged, the winner here). */
  alsoIn?: string[];
}

// Random path generator, REALITY+xhttp benefits from unpredictable paths
// because static "/api/v1/stream" can fingerprint Iceslab deployments.
function randPath(): string {
  const a = Math.random().toString(36).slice(2, 10);
  return `/${a}`;
}

// gRPC serviceName. Random so a static name (e.g. the "grpc-vk" seen in live
// RU configs) doesn't fingerprint every Iceslab RU node identically via the
// subscription URI. The name rides inside the REALITY-encrypted stream and is
// invisible to DPI, so randomising costs no camouflage and removes the tell.
function randServiceName(): string {
  return Math.random().toString(36).slice(2, 10);
}

// AmneziaWG H1-H4 magic-header bytes. Spec requires > 4 + pairwise unique
// + random within int32, a hardcoded 100/200/300/400 fingerprints every
// "Iran-tuned recipe" deploy as Iceslab. Roll fresh on apply.
function randAwgHeader(): number {
  return 5 + Math.floor(Math.random() * (2_147_483_643 - 5));
}
/**
 * What the recipe rail says about the registry sources that failed, one line
 * each, from `sources[]` of the registry answer. A source that fetched fine
 * says nothing. `null` for a server older than `sources[]`: the rail then
 * keeps its one old "registry offline" line when the answer is stale.
 */
export interface RegistryProblem {
  id: string;
  name: string;
  reason: RecipeSourceProblem | 'unknown';
  httpStatus?: number;
}

export function registryProblems(resp: { sources?: unknown } | null | undefined): RegistryProblem[] | null {
  if (!resp || !Array.isArray(resp.sources)) return null;
  const out: RegistryProblem[] = [];
  for (const s of resp.sources as RecipeSourceStatus[]) {
    if (!s || typeof s !== 'object' || s.ok) continue;
    out.push({
      id: s.id,
      name: s.name,
      // A reason this build does not know still gets a line, as «unknown».
      reason: s.reason === 'not-found' || s.reason === 'unreachable' || s.reason === 'invalid' ? s.reason : 'unknown',
      ...(typeof s.httpStatus === 'number' ? { httpStatus: s.httpStatus } : {}),
    });
  }
  return out;
}

/**
 * The tile a recipe lands on, derived, not read: profileKindKey, the very
 * function a saved profile finds its tile by, so a recipe and the profile it
 * makes cannot land apart. sing-box-only protocols (tuic, anytls, shadowtls)
 * key by their own name, a shared protocol on sing-box by `<protocol>#singbox`,
 * the xray subprotocols socks and http by their Telegram tiles. A v1 recipe
 * (no `engine`) lands on its protocol's native tile.
 */
export function recipeTile(r: Pick<Recipe, 'protocol' | 'engine' | 'subprotocol'>): string {
  return profileKindKey(r.protocol, r.engine ?? 'native', r.subprotocol);
}

/**
 * A recipe's words on screen: the panel's translation by id
 * (`recipes.cards.<id>.{name,description,details,notes}`) where the bundle
 * has one, else the recipe's own text. The registry ships English; the
 * Russian of the recipes that used to be built in lives in the panel by id.
 * A recipe nobody translated shows exactly what its author wrote.
 */
export function recipeText(
  recipe: Pick<Recipe, 'id' | 'name' | 'description' | 'details' | 'notes'>,
  has: (key: string) => boolean,
  t: (key: string, opts?: Record<string, unknown>) => unknown,
): { name: string; description: string; details: string; notes: string[] | undefined } {
  const base = `recipes.cards.${recipe.id}`;
  const str = (suffix: string, own: string) => (has(`${base}.${suffix}`) ? String(t(`${base}.${suffix}`)) : own);
  const notes = has(`${base}.notes`) ? t(`${base}.notes`, { returnObjects: true }) : undefined;
  return {
    name: str('name', recipe.name),
    description: str('description', recipe.description),
    details: str('details', recipe.details),
    notes: Array.isArray(notes) ? notes.map(String) : recipe.notes,
  };
}

/** Публичный реестр, из которого панель берёт рецепты (решение владельца
 *  25.09), когда ответ сервера его не назвал. */
export const RECIPES_REPO_DEFAULT = 'icecompany-tech/iceslab-recipes';

/**
 * Ссылка на репозиторий реестра для строки панели рецептов. Сервер называет
 * источник в `source` ответа как `owner/repo@ref`; кривое или отсутствующее
 * значение не ссылка, тогда реестр по умолчанию.
 */
export function registryRepo(source: unknown): { name: string; url: string } {
  const m = typeof source === 'string' ? /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@.*)?$/.exec(source.trim()) : null;
  const slug = m?.[1] ?? RECIPES_REPO_DEFAULT;
  return { name: slug.split('/')[1]!, url: `https://github.com/${slug}` };
}

/**
 * Что панель рецептов говорит, когда показать нечего:
 *
 *   null         есть что показать, или ответ ещё не пришёл;
 *   tile         реестр ответил, у этой плитки рецептов нет;
 *   unavailable  реестр недоступен и снимка нет (сервер старше снимка): в
 *                ответе пусто и он устарел, или запрос упал. Это другое
 *                «пусто»: дело не в плитке, а в источнике.
 */
export function recipeRailEmpty(s: {
  loading: boolean;
  failed: boolean;
  stale: boolean;
  /** Рецептов во всём ответе реестра (по протоколу, до фильтра плитки). */
  answered: number;
  /** Рецептов на этой плитке, из любого источника. */
  shown: number;
}): 'tile' | 'unavailable' | null {
  if (s.loading || s.shown > 0) return null;
  if (s.failed || (s.stale && s.answered === 0)) return 'unavailable';
  return 'tile';
}

/** Рецепты одной плитки (ключ PROFILE_KINDS) из ответа реестра. */
export function recipesOnTile<R extends Pick<Recipe, 'protocol' | 'engine' | 'subprotocol'>>(
  recipes: readonly R[],
  kindKey: string,
): R[] {
  return recipes.filter((r) => recipeTile(r) === kindKey);
}

/**
 * Снимок реестра, который панель носит с собой (32b5719): те же рецепты, что
 * сервер отдаёт как sourceId `builtin`. Экран берёт рецепты из ответа
 * реестра; снимок здесь нужен только как словарь полей для экспорта
 * (RECIPE_APPLY_KEYS) и тестам.
 */
export const SNAPSHOT_RECIPES: Recipe[] = (snapshot as unknown as RecipeSnapshot).recipes.map((w) =>
  fromWireRecipe({ ...w, sourceId: RECIPE_SOURCE_BUILTIN }),
);

// ───── Randomise resolvers ─────

// 16-char base36 secret (Salamander obfs password and similar).
function randPassword16(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  ).slice(0, 16);
}

/** Resolve one declarative randomize descriptor to a concrete value. */
function randomValueFor(kind: RecipeRandomizeKind): string | number {
  switch (kind) {
    case 'token8':
      return randServiceName();
    case 'path':
      return randPath();
    case 'password16':
      return randPassword16();
    case 'awgHeader':
      return randAwgHeader();
  }
}

/**
 * Common profile fields a recipe must never overwrite. They live on the flat
 * FormValues (so `k in current` would let them through) but are not protocol
 * config: a recipe only tunes protocol-specific fields. The apply merge
 * excludes these so an untrusted recipe cannot flip a profile's protocol /
 * engine or silently disable / rename it. Mirrors the backend RecipeSchema.
 */
export const RECIPE_COMMON_FIELDS = new Set([
  'protocol',
  'engine',
  'name',
  'description',
  'enabled',
]);

/**
 * Collapse a recipe's overrides to a single field map: the plain `apply`
 * plus the declarative `randomize` list, resolved per click. AmneziaWG
 * H1-H4 must be pairwise unique (spec), so an awgHeader already drawn for
 * this recipe is drawn again.
 */
export function resolveRecipeApply(
  recipe: Pick<Recipe, 'apply' | 'randomize'>,
): Record<string, string | number | boolean> {
  const base = { ...recipe.apply };
  const headers = new Set<number>();
  for (const r of recipe.randomize ?? []) {
    let v = randomValueFor(r.kind);
    while (r.kind === 'awgHeader' && headers.has(v as number)) v = randomValueFor(r.kind);
    if (r.kind === 'awgHeader') headers.add(v as number);
    base[r.field] = v;
  }
  return base;
}

/**
 * Adapt a registry (wire) recipe to the frontend Recipe shape. The wire type
 * is already assignable except for provenance, which we stamp so the card can
 * badge it as community/official.
 */
export function fromWireRecipe(w: WireRecipe): Recipe {
  return {
    ...w,
    protocol: w.protocol as RecipeProtocol,
    source: w.sourceId === RECIPE_SOURCE_MINE ? 'mine' : w.sourceId === RECIPE_SOURCE_BUILTIN ? 'builtin' : 'registry',
  };
}

// ───── Свои и скрытые (контракт ARCH 25.09) ─────
//
// Сливает дубли СЕРВЕР: один рецепт на id, проигравшие источники у него в
// `alsoIn`. Экран ничего не сливает; два рецепта с одним id в ответе это
// ошибка сервера, её называет duplicateRecipeIds.

/**
 * Курируемый рецепт: из снимка или официальный (verified, ставит CI
 * реестра). Сервер при слиянии ставит источник оператора выше снимка, и
 * официальный источник забирает рецепты снимка себе, а снимок уходит в
 * `alsoIn`. Для оператора это одни и те же рецепты, поэтому место на
 * экране решает курируемость, а не источник.
 */
export function isCuratedRecipe(r: Pick<Recipe, 'source' | 'verified'>): boolean {
  return r.source === 'builtin' || (r.source === 'registry' && r.verified === true);
}

/** Рецепты на показ и скрытые, по `hidden` из ответа реестра. */
export function splitHidden<R extends { id: string }>(recipes: readonly R[], hidden: readonly string[] | undefined): {
  shown: R[];
  hidden: R[];
} {
  const set = new Set(hidden ?? []);
  return { shown: recipes.filter((r) => !set.has(r.id)), hidden: recipes.filter((r) => set.has(r.id)) };
}

/** Список скрытых для PUT (полная замена): скрыть или вернуть один id. */
export function hiddenAfter(hidden: readonly string[] | undefined, id: string, action: 'hide' | 'show'): string[] {
  const rest = (hidden ?? []).filter((x) => x !== id);
  return action === 'hide' ? [...rest, id] : rest;
}

/**
 * Источники, которые ответили, но часть рецептов пропустили (`problems` у
 * статуса источника, ca94cbb): строка на источник со словами сервера, по
 * пропуску на строку. Кривые записи не факт и пропускаются.
 */
export function registrySkips(resp: { sources?: unknown } | null | undefined): { name: string; problems: string[] }[] {
  if (!resp || !Array.isArray(resp.sources)) return [];
  const out: { name: string; problems: string[] }[] = [];
  for (const s of resp.sources as unknown[]) {
    if (!s || typeof s !== 'object') continue;
    const { name, problems } = s as { name?: unknown; problems?: unknown };
    if (typeof name !== 'string' || !Array.isArray(problems)) continue;
    const lines = problems.filter((p): p is string => typeof p === 'string' && p !== '');
    if (lines.length > 0) out.push({ name, problems: lines });
  }
  return out;
}

/** `saved` из ответа импорта как факт, или null. Вход проверяется первым. */
export function importSaved(saved: unknown): RecipeSaved | null {
  if (!saved || typeof saved !== 'object') return null;
  const { id, replaced } = saved as { id?: unknown; replaced?: unknown };
  return typeof id === 'string' && typeof replaced === 'boolean' ? { id, replaced } : null;
}

/** 404 RECIPE_NOT_FOUND на удаление своего: его уже нет. */
export function recipeNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 404 || !res.data || typeof res.data !== 'object') return false;
  return (res.data as { error?: unknown }).error === 'RECIPE_NOT_FOUND';
}

/** id, пришедшие больше одного раза: ошибка сервера, а не состояние экрана. */
export function duplicateRecipeIds(recipes: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const r of recipes) (seen.has(r.id) ? twice : seen).add(r.id);
  return [...twice];
}

// ───── Export (author your own recipe from the current form) ─────

/**
 * Which ProfileForm fields are protocol-specific, derived from what the
 * snapshot's recipes actually set. Doubles as the export allowlist: exporting
 * the current config as a recipe pulls exactly these keys, never common
 * fields like name/enabled.
 */
export const RECIPE_APPLY_KEYS: Record<string, string[]> = (() => {
  const acc: Record<string, Set<string>> = {};
  for (const r of SNAPSHOT_RECIPES) {
    const set = (acc[r.protocol] ??= new Set<string>());
    for (const k of Object.keys(r.apply)) set.add(k);
    for (const rz of r.randomize ?? []) set.add(rz.field);
  }
  const out: Record<string, string[]> = {};
  for (const [proto, set] of Object.entries(acc)) out[proto] = [...set];
  return out;
})();

export interface RecipeExportMeta {
  id: string;
  name: string;
  description: string;
  details?: string;
  emoji?: string;
  dpiResistance: number;
  speed: number;
  region?: string;
}

/**
 * Build a shareable recipe from the current form values. Only the protocol's
 * own fields (RECIPE_APPLY_KEYS) are captured, as a static snapshot: any
 * value the operator randomised is frozen to what is in the form now.
 */
export function buildExportRecipe(
  protocol: string,
  values: Record<string, unknown>,
  meta: RecipeExportMeta,
): Recipe {
  const apply: Record<string, string | number | boolean> = {};
  for (const k of RECIPE_APPLY_KEYS[protocol] ?? []) {
    const v = values[k];
    if (typeof v === 'string' && v !== '') apply[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') apply[k] = v;
  }
  const clampRating = (n: number) =>
    (Math.min(5, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4 | 5);
  // Схема v2: рецепт называет ядро и, у xray, подпротокол, как профиль.
  const sub = values.xraySubprotocol;
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: meta.id,
    engine: values.engine === 'singbox' ? 'singbox' : 'native',
    protocol: protocol as RecipeProtocol,
    ...(protocol === 'xray' && typeof sub === 'string' && sub !== '' ? { subprotocol: sub } : {}),
    emoji: meta.emoji || '⭐',
    name: meta.name,
    description: meta.description,
    details: meta.details || meta.description,
    dpiResistance: clampRating(meta.dpiResistance),
    speed: clampRating(meta.speed),
    apply,
    region: meta.region,
  };
}

/**
 * Куда рецепт кладётся в форке реестра icecompany-tech/iceslab-recipes:
 * `recipes/<engine>/<wire>/<id>.json`. Проводное имя это протокол; у
 * семейства xray ещё папка подпротокола (`xray/vless`, `xray/trojan`), а
 * SOCKS5 и HTTP лежат в своих папках (`socks`, `http`), как их плитки.
 * Раскладка сверена с деревом реестра 25.09 (тест по 22 рецептам снимка).
 */
export function registryRecipePath(r: Pick<Recipe, 'id' | 'engine' | 'subprotocol'> & { protocol: string }): string {
  const sub = r.subprotocol;
  const wire =
    r.protocol === 'xray' ? (sub === 'socks' || sub === 'http' ? sub : `xray/${sub || 'vless'}`) : r.protocol;
  return `recipes/${r.engine ?? 'native'}/${wire}/${r.id}.json`;
}

/** Trigger a browser download of a recipe as pretty JSON. */
export function downloadRecipeJson(recipe: Recipe): void {
  const blob = new Blob([JSON.stringify(recipe, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${recipe.id || 'recipe'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ───── Live validator ─────
//
// Returns warnings/errors for the current form state. Errors block save
// (returned as `level: 'error'`); warnings just inform.

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  field?: string;
  // Locale-agnostic key + interpolation args. The caller resolves to a
  // string via i18n t(). Earlier this carried a pre-rendered RU-only
  // `message`, which leaked Russian into the EN locale. Forms render with
  // t(issue.key, issue.args ?? {}).
  key: string;
  args?: Record<string, string>;
}

export function validateXrayConfig(values: {
  xrayNetwork: string;
  xrayFlow: string;
  xraySubprotocol: string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Hard error: REALITY only works with raw/xhttp/grpc.
  // Form already filters dropdown to these 3, but defensive, paste/import
  // could carry an invalid value.
  if (!['raw', 'xhttp', 'grpc'].includes(values.xrayNetwork)) {
    issues.push({
      level: 'error',
      field: 'xrayNetwork',
      key: 'validation.xray.networkInvalid',
      args: { network: values.xrayNetwork },
    });
  }

  // Hard error: Vision requires raw.
  if (values.xrayFlow === 'xtls-rprx-vision' && values.xrayNetwork !== 'raw') {
    issues.push({
      level: 'error',
      field: 'xrayFlow',
      key: 'validation.xray.visionRequiresRaw',
      args: { network: values.xrayNetwork },
    });
  }

  // Warning: Trojan + Vision, Trojan не поддерживает Vision.
  if (values.xraySubprotocol === 'trojan' && values.xrayFlow !== '') {
    issues.push({
      level: 'warning',
      field: 'xrayFlow',
      key: 'validation.xray.trojanIgnoresFlow',
    });
  }

  // Info: best practice.
  if (values.xrayNetwork === 'raw' && values.xrayFlow === '') {
    issues.push({
      level: 'info',
      key: 'validation.xray.rawWithoutVisionSlow',
    });
  }

  return issues;
}
