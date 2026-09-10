import type { RoutingPresetId } from '@iceslab/shared';
/* ───── Preset contents ─────────────────────────────────────────────────── */

/**
 * What each preset emits, mirrored from `formats/xrayjson.ts` (RU_SPLIT_RULES /
 * CN_SPLIT_RULES). It is a copy and it can drift, so it is only read while
 * `GET /api/routing-presets` is missing: the moment that endpoint answers, the
 * query below wins and this table can be deleted.
 */
export interface PresetRule {
  match: string[];
  action: 'direct' | 'block' | 'proxy';
}

export const PRESET_RULES: Record<RoutingPresetId, PresetRule[]> = {
  'proxy-all': [],
  'ru-split': [
    { match: ['geosite:category-ads-all'], action: 'block' },
    { match: ['geosite:category-ru', 'geosite:category-gov-ru'], action: 'direct' },
    { match: ['geoip:private', 'geoip:ru'], action: 'direct' },
  ],
  'cn-split': [
    { match: ['geosite:category-ads-all'], action: 'block' },
    { match: ['geosite:cn'], action: 'direct' },
    { match: ['geoip:private', 'geoip:cn'], action: 'direct' },
  ],
};

/**
 * Why each built-in rule exists, keyed by its matcher. This is panel copy, not
 * operator data: the backend ships rules, it has no business carrying a
 * translated sentence, so the note is looked up here whether the rule came from
 * the API or from the mirror above.
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
