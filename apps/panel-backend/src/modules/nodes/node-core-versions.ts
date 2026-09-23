import {
  CORE_COMPONENTS,
  checkCoreVersionIntent,
  type CoreComponent,
  type NodeCoreVersions,
} from '@iceslab/shared';

/**
 * Node.coreVersions: which core versions the operator wants on one node.
 *
 * An intent, not a report (that is `cores`). Stored as { component: version };
 * a missing key is the pin, so '{}' follows the manifest when the pin moves.
 * Every write is checked against the manifest: a component it knows, and a
 * version it lists, because the manifest is where a version gets its sha256 and
 * a version without one is not installed.
 */

/**
 * What a PUT may send, per component: a version sets it, null puts it back on
 * the pin, and a component the body leaves out is not touched. Three values,
 * because the read side has three (chosen, pin, and "this edit is not about
 * it"); a PUT that could only send the whole map would reset every choice the
 * screen does not show.
 */
export type CoreVersionsPatch = Partial<Record<CoreComponent, string | null>>;

export class CoreVersionIntentError extends Error {
  readonly code = 'CORE_VERSION_NOT_LISTED';

  constructor(public problems: string[]) {
    super(`Core versions refused: ${problems.join('; ')}`);
    this.name = 'CoreVersionIntentError';
  }
}

/**
 * The stored intent as the code reads it. The column is an object by
 * constraint; anything else in it (a hand edit) reads as "the pins" rather than
 * crashing a node page.
 */
export function readCoreVersions(raw: unknown): NodeCoreVersions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: NodeCoreVersions = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((CORE_COMPONENTS as readonly string[]).includes(key) && typeof value === 'string') {
      out[key as CoreComponent] = value;
    }
  }
  return out;
}

/**
 * The intent after a patch: set what it sets, drop what it nulls, keep the
 * rest. Throws CoreVersionIntentError when the RESULT names anything the
 * manifest does not list, including a stored choice whose release has since
 * been taken off the list: the operator sees it named and can put that
 * component back on the pin.
 */
export function applyCoreVersionsPatch(
  stored: NodeCoreVersions,
  patch: CoreVersionsPatch | null,
): NodeCoreVersions {
  const next: NodeCoreVersions = patch === null ? {} : { ...stored };
  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      const component = key as CoreComponent;
      if (value === undefined) continue;
      if (value === null) delete next[component];
      else next[component] = value;
    }
  }
  const problems = checkCoreVersionIntent(next);
  if (problems.length) throw new CoreVersionIntentError(problems);
  return next;
}
