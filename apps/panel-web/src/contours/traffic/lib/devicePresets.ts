import type { RoutingPreset, RoutingPresetInput } from '@/lib/old/routePolicies';
import type { RoutingPresetId } from '@iceslab/shared';
/* ───── Preset contents ─────────────────────────────────────────────────── */

// The rules of every preset, the three built-ins too, come from
// GET /api/routing-presets (A-229). The copy of the built-in rules that stood
// here while the endpoint was missing is gone: one model per thing.

/**
 * Why each built-in rule exists, keyed by its matcher. This is panel copy, not
 * operator data: the backend ships rules, it has no business carrying a
 * translated sentence, so the note is looked up here for the built-ins.
 */
export const NOTE_BY_MATCH: Record<string, string> = {
  'geosite:category-ads-all': 'routes.noteAds',
  'geosite:category-ru': 'routes.noteRuDomains',
  'geosite:cn': 'routes.noteCnDomains',
  'geoip:ru': 'routes.noteRuIps',
  'geoip:cn': 'routes.noteCnIps',
};

export function noteKeyFor(match: string[]): string | undefined {
  const hit = match.find((m) => NOTE_BY_MATCH[m] !== undefined);
  return hit === undefined ? undefined : NOTE_BY_MATCH[hit];
}

/** The clean resolver each split preset points local domains at. */
export const PRESET_DNS: Partial<Record<RoutingPresetId, string>> = {
  'ru-split': '77.88.8.8',
  'cn-split': '223.5.5.5',
};

// PRESET_IDS / presetKey / isBuiltInPresetId now live in lib/routingPresets.ts:
// the Users filter needs the same list and the same labels.

/* ───── Page ────────────────────────────────────────────────────────────── */

export const NEW_PRESET_ID = '__new__';

export function blankPreset(): RoutingPreset {
  return { id: NEW_PRESET_ID, name: '', builtIn: false, rules: [] };
}

/**
 * What a save of the preset editor sends. A new preset goes whole; an existing
 * one sends only what changed against what it was opened with, so a rename
 * does not restate the rules another tab just edited. Nothing changed: null.
 */
export function presetWrite(
  preset: RoutingPreset,
  name: string,
  rules: RoutingPresetInput['rules'],
  initial: RoutingPresetInput['rules'],
):
  | { kind: 'create'; input: RoutingPresetInput }
  | { kind: 'update'; input: Partial<RoutingPresetInput> }
  | null {
  const typed = name.trim() || preset.name;
  if (preset.id === NEW_PRESET_ID) return { kind: 'create', input: { name: typed, rules } };
  const input: Partial<RoutingPresetInput> = {};
  if (typed !== preset.name) input.name = typed;
  if (JSON.stringify(rules) !== JSON.stringify(initial)) input.rules = rules;
  return Object.keys(input).length > 0 ? { kind: 'update', input } : null;
}
