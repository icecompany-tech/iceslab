import { ROUTING_PRESET_IDS, isRoutingPresetId, type RoutingPresetId } from '@iceslab/shared';
/**
 * The built-in device presets, re-exported from the shared package rather than
 * listed again here.
 *
 * The backend validates the request with `z.enum(ROUTING_PRESET_IDS)` from the
 * same module, so a fourth preset added on this side would produce a filter
 * value the API answers 400 to. One list, one place.
 *
 * What DOES belong to the frontend is the naming: these three are panel copy,
 * not operator data, so their labels are translated from the id whatever the
 * API happens to call them.
 */
export { ROUTING_PRESET_IDS, isRoutingPresetId };

/** The i18n suffix under `metadata.preset*` for a built-in id. */
export function presetKey(id: RoutingPresetId): string {
  return id === 'ru-split' ? 'RuSplit' : id === 'cn-split' ? 'CnSplit' : 'ProxyAll';
}

/**
 * A-229: a user or a squad takes one preset, a built-in key (`routingPreset`)
 * or an own one by id (`customRoutingPresetId`), never both. A picker holds the
 * pair as ONE value: '' inherits, a built-in key, or an own preset's id. The
 * two cannot be confused: a built-in key is never a uuid.
 */
export interface PresetPair {
  routingPreset?: RoutingPresetId | null;
  customRoutingPresetId?: string | null;
}

export function presetChoiceOf(v: PresetPair | null | undefined): string {
  return v?.customRoutingPresetId || v?.routingPreset || '';
}

/**
 * What a save sends for the picker: nothing when it did not move. A value goes
 * under its own key and the server clears the other side; going back to
 * inherit clears the side that was set, and only that one.
 */
export function presetChoicePatch(seed: string, value: string): PresetPair {
  if (seed === value) return {};
  if (value === '') {
    return isRoutingPresetId(seed) ? { routingPreset: null } : { customRoutingPresetId: null };
  }
  return isRoutingPresetId(value) ? { routingPreset: value } : { customRoutingPresetId: value };
}

/**
 * The name of a choice, or null when it is an own preset the list does not
 * name: the list did not arrive, or the preset is gone. The caller says which;
 * an id is never shown as a name.
 */
export function presetChoiceName(
  value: string,
  own: readonly { id: string; name: string }[] | undefined,
  builtInName: (id: RoutingPresetId) => string,
): string | null {
  if (value === '') return null;
  if (isRoutingPresetId(value)) return builtInName(value);
  return own?.find((p) => p.id === value)?.name ?? null;
}

/**
 * 400 ROUTING_PRESET_NOT_FOUND {field: 'customRoutingPresetId'} (A-229): the
 * own preset picked on a user or a squad was deleted while the form was open.
 * The input is checked first.
 */
export function assignedPresetGone(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return false;
  const { status, data } = res as { status?: unknown; data?: unknown };
  return status === 400 && !!data && typeof data === 'object' && (data as { error?: unknown }).error === 'ROUTING_PRESET_NOT_FOUND';
}

/**
 * The picker's rows: inherit, the three built-ins, then the operator's own
 * presets from the list. An own preset the list does not carry (list failed or
 * still loading, or the preset was deleted elsewhere) keeps its row under
 * `unnamed`, so the Select still shows what is stored instead of going blank.
 */
export function presetChoiceRows(
  current: string,
  own: readonly { id: string; name: string; builtIn: boolean }[] | undefined,
  words: { inherit: string; unnamed: string; builtInName: (id: RoutingPresetId) => string },
): { value: string; label: string }[] {
  const rows = [
    { value: '', label: words.inherit },
    ...ROUTING_PRESET_IDS.map((id) => ({ value: id, label: words.builtInName(id) })),
    ...(own ?? []).filter((p) => !p.builtIn).map((p) => ({ value: p.id, label: p.name })),
  ];
  if (current !== '' && !rows.some((r) => r.value === current)) rows.push({ value: current, label: words.unnamed });
  return rows;
}
