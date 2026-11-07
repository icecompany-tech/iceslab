import type { RoutingPresetRefusal } from '@/lib/old/routePolicies';

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Names in quotes, capped: the server lists at most fifty holders, the count
 * is the whole truth, and the rest is said as «и ещё N» rather than dropped.
 */
export function heldNames(names: readonly string[], count: number, t: Translate, shown = 5): string {
  const head = names.slice(0, shown).map((n) => `«${n}»`).join(', ');
  const rest = count - Math.min(names.length, shown);
  return rest > 0 ? t('routes.presetHeldMore', { names: head, count: rest }) : head;
}

/**
 * The sentence for a refused preset write (A-229). Entries are also marked in
 * their rows and a taken name at the name field; this is the one line beside
 * them, in the panel's words.
 */
export function presetRefusalWords(r: RoutingPresetRefusal, t: Translate): string {
  switch (r.code) {
    case 'ROUTING_PRESET_ENTRY_UNKNOWN':
      return t('routes.presetEntryUnknown', { entries: r.entries.join(', ') });
    case 'ROUTING_PRESET_GEO_TAG_UNKNOWN':
      return t('routes.presetGeoTagUnknown', { entries: r.entries.join(', ') });
    case 'ROUTING_PRESET_BUILT_IN':
      return t('routes.presetBuiltInRefused');
    case 'NOT_FOUND':
      return t('routes.presetGone');
    case 'NAME_TAKEN':
      return t('routes.presetNameTaken');
    case 'ROUTING_PRESET_IN_USE': {
      const parts = [
        r.userCount > 0 ? t('routes.presetHeldUsers', { count: r.userCount, names: heldNames(r.users, r.userCount, t) }) : null,
        r.squadCount > 0 ? t('routes.presetHeldSquads', { count: r.squadCount, names: heldNames(r.squads, r.squadCount, t) }) : null,
      ].filter(Boolean);
      return t('routes.presetInUse', { holders: parts.join('; ') });
    }
  }
}
