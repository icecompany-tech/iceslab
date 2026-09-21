import type { RouteRule } from '@/lib/domain/routePolicies';
export function strip(rules: RouteRule[]) {
  return rules.map((r) => ({ match: r.match, action: r.action, note: r.note }));
}

export function findShadows(rules: RouteRule[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const rule of rules) {
    if (rule.match.length === 0) continue;
    const hit = rule.match.find((m) => seen.has(m));
    if (hit !== undefined) {
      out.set(rule.id, hit);
      continue;
    }
    for (const m of rule.match) seen.add(m);
  }
  return out;
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

/**
 * Правила пресета с ключами для отрисовки.
 *
 * Ключ детерминирован позицией: счётчик в `useRef`, который раньше давал их,
 * приходилось читать и увеличивать прямо в рендере, а рендер обязан быть
 * чистым. Префикс `seed-` держит их врозь с ключами строк, добавленных руками
 * (`new-`), и пересечься они не могут.
 */
export function seedRules(rules: RouteRule[]): RouteRule[] {
  return rules.map((r, i) => ({ ...r, id: r.id || `seed-${i}` }));
}
