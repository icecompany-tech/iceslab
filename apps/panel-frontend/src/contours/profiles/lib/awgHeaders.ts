import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

/**
 * AmneziaWG H1..H4 on the profile form (A-286).
 *
 * A new profile used to open with the four fields empty, and the save sent an
 * empty one as 0: the server's schema wants each above 4 and all four distinct
 * (panel-backend inbounds.schemas.ts:279-282), so a profile created with the
 * preset untouched was refused with «Invalid input» and no field named.
 *
 *  - a new profile is seeded with random headers (randomAwgHeaders, in
 *    profileDefaults); an edit keeps what is stored;
 *  - empty, below 5 and repeated headers are the form's to refuse, on the
 *    field, before the request;
 *  - an empty header is never sent, so 0 never leaves the form. Not sending is
 *    not a way out either: the PUT replaces the config whole and the server
 *    would put its own defaults in place of the stored headers, which must
 *    match every client's config;
 *  - the server's refusal on config.obfuscation.hN is marked on that field.
 */
export const AWG_H_MIN = 5;
export const AWG_H_FIELDS = ['awgH1', 'awgH2', 'awgH3', 'awgH4'] as const;
export type AwgHField = (typeof AWG_H_FIELDS)[number];
type AwgHValues = Pick<FormValues, AwgHField>;

const SERVER_FIELD: Record<string, AwgHField> = { h1: 'awgH1', h2: 'awgH2', h3: 'awgH3', h4: 'awgH4' };

function valueOf(v: number | '' | string | null | undefined): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The headers that are wrong: empty, not a whole number above 4, or equal
 *  to another header (both of the pair are marked). */
export function awgHeaderProblems(values: AwgHValues): Set<AwgHField> {
  const bad = new Set<AwgHField>();
  const seen = new Map<number, AwgHField>();
  for (const field of AWG_H_FIELDS) {
    const n = valueOf(values[field]);
    if (n === null || !Number.isInteger(n) || n < AWG_H_MIN) {
      bad.add(field);
      continue;
    }
    const twin = seen.get(n);
    if (twin) {
      bad.add(twin);
      bad.add(field);
    } else seen.set(n, field);
  }
  return bad;
}

/** The h1..h4 of the config: a filled header as it is, an empty one not at
 *  all. Never 0. */
export function awgHeaderConfig(values: AwgHValues): { h1?: number; h2?: number; h3?: number; h4?: number } {
  const out: { h1?: number; h2?: number; h3?: number; h4?: number } = {};
  AWG_H_FIELDS.forEach((field, i) => {
    const n = valueOf(values[field]);
    if (n !== null) out[`h${i + 1}` as 'h1'] = n;
  });
  return out;
}

/** 400 VALIDATION_ERROR with issues at ['config', 'obfuscation', 'hN']
 *  (too_small and pairwise distinct alike): the form fields they name. The
 *  input is checked first; an empty list = not this refusal. */
export function awgHeaderRefusal(err: unknown): AwgHField[] {
  if (!err || typeof err !== 'object') return [];
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return [];
  const d = res.data as { error?: unknown; issues?: unknown };
  if (d.error !== 'VALIDATION_ERROR' || !Array.isArray(d.issues)) return [];
  const fields = new Set<AwgHField>();
  for (const issue of d.issues) {
    if (!issue || typeof issue !== 'object') continue;
    const path = (issue as { path?: unknown }).path;
    if (!Array.isArray(path) || path.length !== 3 || path[0] !== 'config' || path[1] !== 'obfuscation') continue;
    const key: unknown = path[2];
    if (typeof key === 'string' && Object.hasOwn(SERVER_FIELD, key)) fields.add(SERVER_FIELD[key]!);
  }
  return AWG_H_FIELDS.filter((f) => fields.has(f));
}
