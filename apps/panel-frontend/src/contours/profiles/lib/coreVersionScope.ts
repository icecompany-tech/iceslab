import { componentsOfEngine, type CoreComponent, type EngineName } from '@iceslab/shared';
import type { PreviewKindKey } from '@/contours/profiles/lib/profileKinds';

/**
 * What the core version strip on a tile can say.
 *
 *   components  the manifest's components of the tile's engine: the strip
 *               names each pin and counts the fleet against it;
 *   unbuilt     a view the panel draws ahead of its backend (WEB): no
 *               component in the manifest, and the honest line is that the
 *               panel neither installs nor pins its core yet. No fleet count:
 *               there is nothing to count;
 *   none        an engine the manifest has no component for (not today).
 */
export type CoreVersionScope =
  | { kind: 'components'; components: CoreComponent[] }
  | { kind: 'unbuilt'; textKey: string }
  | { kind: 'none' };

const UNBUILT: Record<PreviewKindKey, string> = {
  telegramweb: 'profiles.engine.webNoCore',
};

export function coreVersionScope(tile: EngineName | PreviewKindKey): CoreVersionScope {
  if (tile in UNBUILT) return { kind: 'unbuilt', textKey: UNBUILT[tile as PreviewKindKey] };
  const components = componentsOfEngine(tile);
  return components.length > 0 ? { kind: 'components', components } : { kind: 'none' };
}
