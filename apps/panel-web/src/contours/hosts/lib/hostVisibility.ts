import { serverDescriptionProblem, type ServerDescriptionProblem } from '@iceslab/shared';

/**
 * The host's own description and «hidden» switch (A-236 step 6).
 *
 * The server knows both when its hosts carry the keys. On an edit the host
 * says it; on a new host the list does (every host carries them, or there are
 * none to tell by). A server older than step 6 gets neither field drawn nor
 * either key sent: an absent key is not «no» and not «empty».
 */
export function visibilityKnown(
  isNew: boolean,
  host: { isHidden?: unknown } | null,
  hosts: readonly { isHidden?: unknown }[] | undefined,
): boolean {
  if (!isNew) return host !== null && typeof host.isHidden === 'boolean';
  return hosts !== undefined && hosts.every((h) => typeof h.isHidden === 'boolean');
}

/**
 * The list's «hidden» mark: the operator's switch only, `true` and nothing
 * else (an older server's missing key is not «hidden»). Apart from
 * `hiddenByCascade`, which is the cascade's doing and has its own line.
 */
export function hiddenByOperator(host: { isHidden?: unknown }): boolean {
  return host.isHidden === true;
}

/**
 * The field's own check, before the server's: an empty field is «clear it»
 * (null on save), not a problem; anything else goes through the shared rule,
 * the one the server refuses by (one line, length in code points).
 */
export function descriptionProblem(typed: string): ServerDescriptionProblem | null {
  return typed === '' ? null : serverDescriptionProblem(typed);
}

/**
 * The keys of the save: on a new host only what was set, on an edit only what
 * changed. Clearing sends null, never an empty string.
 */
export function visibilityPatch(
  stored: { serverDescription?: string | null; isHidden?: boolean } | null,
  typed: string,
  hidden: boolean,
): { serverDescription?: string | null; isHidden?: boolean } {
  const description = typed === '' ? null : typed;
  if (stored === null) {
    return { ...(description !== null ? { serverDescription: description } : {}), ...(hidden ? { isHidden: true } : {}) };
  }
  return {
    ...(description !== (stored.serverDescription ?? null) ? { serverDescription: description } : {}),
    ...(hidden !== (stored.isHidden ?? false) ? { isHidden: hidden } : {}),
  };
}
