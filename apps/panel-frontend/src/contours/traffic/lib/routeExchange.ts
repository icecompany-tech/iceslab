import type { RouteAction, RoutePolicy, RouteRule } from '@/lib/domain/routePolicies';
import { ACTIONS } from '@/contours/traffic/lib/routeActions';
/** Parsed entries, or an i18n key naming what is wrong with the file. */
export interface Exchanged {
  name: string;
  rules: RouteRule[];
}

/** A policy's rules, derived from the domain lists when the API sends no list. */
export function policyRules(p: RoutePolicy): { match: string[]; action: RouteAction; note: string }[] {
  if (p.rules) return p.rules.map((r) => ({ match: r.match, action: r.action, note: r.note }));
  const out: { match: string[]; action: RouteAction; note: string }[] = [];
  if (p.blockDomains.length > 0) out.push({ match: p.blockDomains, action: 'block', note: '' });
  if (p.directDomains.length > 0) out.push({ match: p.directDomains, action: 'direct', note: '' });
  return out;
}

export function exportJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseImport(text: string): Exchanged[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'routes.importBadJson';
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.policies)
      ? parsed.policies
      : isRecord(parsed) && Array.isArray(parsed.presets)
        ? parsed.presets
        : null;
  if (raw === null) return 'routes.importBadShape';
  if (raw.length === 0) return 'routes.importEmpty';

  const out: Exchanged[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.rules)) {
      return 'routes.importBadShape';
    }
    const rules: RouteRule[] = [];
    for (const [j, rule] of entry.rules.entries()) {
      if (!isRecord(rule) || !Array.isArray(rule.match) || !rule.match.every((m) => typeof m === 'string')) {
        return 'routes.importBadShape';
      }
      if (typeof rule.action !== 'string' || !ACTIONS.includes(rule.action as RouteAction)) {
        return 'routes.importBadAction';
      }
      rules.push({
        id: `i${i}-${j}`,
        match: rule.match as string[],
        action: rule.action as RouteAction,
        note: typeof rule.note === 'string' ? rule.note : '',
      });
    }
    out.push({ name: entry.name, rules });
  }
  return out;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/* ───── Data helpers ────────────────────────────────────────────────────── */

/** Trimmed, deduped, non-empty lines. */
export function splitLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const d = raw.trim();
    if (d.length > 0 && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/** The rules field as three states: empty, a parsed array, or a reason it is
 *  neither. Empty clears the setting rather than saving `[]`. */
export function parseRules(text: string): { rules: Record<string, unknown>[] | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { rules: null, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { rules: null, error: 'routes.rulesInvalidJson' };
  }
  if (!Array.isArray(parsed) || !parsed.every((r) => r !== null && typeof r === 'object')) {
    return { rules: null, error: 'routes.rulesNotArray' };
  }
  return { rules: parsed as Record<string, unknown>[], error: null };
}

/* ───── Icons ───────────────────────────────────────────────────────────── */
