/**
 * The port hopping range of a hysteria profile (A-284). Both bounds or
 * neither, and the end above the start; the server checks the same since
 * 94266ace and refuses on the field.
 *
 * The form used to send the range only when both bounds were filled, so one
 * bound was dropped without a word and the profile saved as a single port.
 * Now each bound filled is sent as it is, the form catches a half or reversed
 * range first, and a refusal the server still gives (an old profile saved
 * before the check) is marked on the same field with the same sentence.
 *
 * One sentence per field, not per cause: the server's message is English and
 * only its path is the contract, and the end field covers two causes (missing,
 * not above the start).
 */
export const PORT_HOP_FIELDS = ['hyPortHopStart', 'hyPortHopEnd'] as const;
export type PortHopField = (typeof PORT_HOP_FIELDS)[number];

type Bound = number | string | null | undefined;

const SERVER_FIELD: Record<string, PortHopField> = {
  portHoppingStart: 'hyPortHopStart',
  portHoppingEnd: 'hyPortHopEnd',
};

/** A bound left empty is no bound; anything typed is one, and the server
 *  judges what Number makes of it. */
function boundOf(v: Bound): number | null {
  if (v === '' || v === null || v === undefined) return null;
  return Number(v);
}

/** The field a half or reversed range is wrong on; null = nothing to say. */
export function portHopProblem(start: Bound, end: Bound): PortHopField | null {
  const s = boundOf(start);
  const e = boundOf(end);
  if (s === null && e === null) return null;
  if (s === null) return 'hyPortHopStart';
  if (e === null || !(e > s)) return 'hyPortHopEnd';
  return null;
}

/** The config keys: every bound filled goes, none is dropped. */
export function portHopConfig(start: Bound, end: Bound): { portHoppingStart?: number; portHoppingEnd?: number } {
  const s = boundOf(start);
  const e = boundOf(end);
  return {
    ...(s !== null ? { portHoppingStart: s } : {}),
    ...(e !== null ? { portHoppingEnd: e } : {}),
  };
}

/** 400 VALIDATION_ERROR with an issue at ['config', 'portHoppingStart' |
 *  'portHoppingEnd']: the form field it names. The input is checked first;
 *  null = not this refusal. */
export function portHopRefusal(err: unknown): PortHopField | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as { error?: unknown; issues?: unknown };
  if (d.error !== 'VALIDATION_ERROR' || !Array.isArray(d.issues)) return null;
  for (const issue of d.issues) {
    if (!issue || typeof issue !== 'object') continue;
    const path = (issue as { path?: unknown }).path;
    if (!Array.isArray(path) || path.length !== 2 || path[0] !== 'config') continue;
    const key: unknown = path[1];
    if (typeof key === 'string' && Object.hasOwn(SERVER_FIELD, key)) return SERVER_FIELD[key];
  }
  return null;
}

/** The sentence for the field, the same from the form and from the server. */
export function portHopWords(field: PortHopField, t: (key: string) => string): string {
  return t(field === 'hyPortHopStart' ? 'profileForm.portRangeNoStart' : 'profileForm.portRangeBadEnd');
}
