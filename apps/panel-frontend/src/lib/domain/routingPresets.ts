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
