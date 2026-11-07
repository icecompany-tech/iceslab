/**
 * The open-ports check on the node page, read with the input checked first.
 *
 * The server answers `{ checked, extras?: string[] }` (nodes.exposure.ts):
 * `extras` are the ufw-allowed ports nobody expects, as «8080/tcp». The note
 * used to read `unexpectedPorts`, a field the server never sends, so every
 * checked node said «no unexpected open ports», open ports included; and its
 * three strings had gone with the old node modal (f4d35522), so the screen
 * printed the key.
 *
 *   skipped  the check could not run, with the server's note;
 *   clean    checked, and `extras` is an empty list;
 *   extra    checked, with the ports;
 *   unknown  checked, but no list to read: not said as clean.
 */
export type ExposureView =
  | { kind: 'skipped'; note: string | null }
  | { kind: 'clean' }
  | { kind: 'extra'; ports: string[] }
  | { kind: 'unknown' };

export function exposureView(raw: unknown): ExposureView {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.checked !== 'boolean') return { kind: 'unknown' };
  if (!r.checked) return { kind: 'skipped', note: typeof r.note === 'string' && r.note !== '' ? r.note : null };
  if (!Array.isArray(r.extras)) return { kind: 'unknown' };
  const ports = r.extras.filter((p): p is string => typeof p === 'string');
  return ports.length === 0 ? { kind: 'clean' } : { kind: 'extra', ports };
}

/** The keys the note draws, for the guard test that both locales have them. */
export const EXPOSURE_KEYS = [
  'nodeEdit.exposureSkipped',
  'nodeEdit.exposureClean',
  'nodeEdit.exposureExtra',
  'nodeEdit.exposureUnknown',
] as const;
