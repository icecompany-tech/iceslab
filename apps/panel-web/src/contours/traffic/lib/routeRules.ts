import type { RouteAction, RoutePolicy, RouteRule } from '@/lib/old/routePolicies';

/**
 * Правило в черновике экрана.
 *
 * Псевдоним, а не интерфейс-наследник: пустое `extends` не добавляло ни одного
 * поля и читалось как обещание, что черновик когда-нибудь разойдётся с
 * контрактом. Он не разошёлся, и имя стоит здесь ровно затем, чтобы экраны
 * говорили «черновик», а не «правило из ответа API».
 */
export type DraftRule = RouteRule;

export const NEW_POLICY_ID = '__new__';

/** A blank policy for the New-policy button to open. */
export function blankPolicy(): RoutePolicy {
  return { id: NEW_POLICY_ID, name: '', ordinal: 0, rules: [], directDomains: [], blockDomains: [] };
}

/* ───── Model ───────────────────────────────────────────────────────────── */

/**
 * What a route policy (entry) can do with a domain: exactly what the server
 * stores, two lists (A-151, decisions.md 2026-10-22). WARP and proxy by domain
 * live in the exit node's policy; an editor that offered them here saved
 * "successfully" and the rule was gone.
 */
export const POLICY_ACTIONS: RouteAction[] = ['block', 'direct'];

/**
 * The policy as rows, one per domain, block first: the two lists the server
 * stores, and nothing else. `rules`, if a server ever sends it, is not read:
 * the screen shows what is stored.
 *
 * Ключи строк ДЕТЕРМИНИРОВАНЫ: позиция плюс префикс источника. Раньше их давал
 * счётчик в `useRef`, который приходилось читать и увеличивать прямо в рендере,
 * а рендер обязан быть чистым. Префикс `seed-` держит их врозь с ключами строк,
 * которые оператор добавляет руками (`new-`), и пересечься они не могут.
 */
export function toRules(policy: RoutePolicy): DraftRule[] {
  return [
    ...policy.blockDomains.map((d, i) => ({
      id: `seed-b${i}`,
      match: [d],
      action: 'block' as const,
      note: '',
    })),
    ...policy.directDomains.map((d, i) => ({
      id: `seed-d${i}`,
      match: [d],
      action: 'direct' as const,
      note: '',
    })),
  ];
}

/** The payload shape, without the client-side keys. */
export function strip(rules: DraftRule[]) {
  return rules.map((r) => ({ match: r.match, action: r.action }));
}

/**
 * The draft as the server will store it: two sets of domains. Row order,
 * which row a domain sits in and repeats do not survive a save, so they do
 * not make the draft "unsaved" either.
 */
export function policySets(rules: Pick<DraftRule, 'match' | 'action'>[]): { block: string[]; direct: string[] } {
  const pick = (action: RouteAction) =>
    [...new Set(rules.filter((r) => r.action === action).flatMap((r) => r.match.filter(Boolean)))].sort();
  return { block: pick('block'), direct: pick('direct') };
}

/**
 * An imported rule list folded into the two lists the server keeps. Rules
 * with any other action (WARP, proxy) are counted, not kept: they belong to
 * the exit node's policy.
 */
export function importedPolicy(rules: Pick<DraftRule, 'match' | 'action'>[]): {
  lists: { blockDomains: string[]; directDomains: string[] };
  dropped: number;
} {
  const sets = policySets(rules);
  return {
    lists: { blockDomains: sets.block, directDomains: sets.direct },
    dropped: rules.filter((r) => !POLICY_ACTIONS.includes(r.action)).length,
  };
}

/** Whether the draft differs from the stored policy, compared as the server stores it. */
export function policyDirty(policy: RoutePolicy, name: string, rules: Pick<DraftRule, 'match' | 'action'>[]): boolean {
  if (policy.id === NEW_POLICY_ID || name !== policy.name) return true;
  const draft = policySets(rules);
  const stored = {
    block: [...new Set(policy.blockDomains)].sort(),
    direct: [...new Set(policy.directDomains)].sort(),
  };
  return JSON.stringify(draft) !== JSON.stringify(stored);
}

/** Matchers are entered as one line, separated by spaces or middots. */
export function splitMatch(value: string): string[] {
  return value
    .split(/[\s·,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Which rows can never fire, and because of what: counted the way the node
 * renders the policy (A-151), block always above direct whatever the row
 * order (`cascade.config.ts:1475, 1480`). A domain in both lists is blocked,
 * so the DIRECT row is the dead one; a domain repeated within one list is
 * dead in the later row.
 *
 * Only exact matcher collisions are reported, which is provable from the
 * strings alone. Real subsumption (geosite:google swallowing geosite:youtube)
 * needs the geosite database, which the panel does not have, so those go
 * unflagged rather than guessed at.
 */
export function findShadows(rules: DraftRule[]): Map<string, { match: string; by: RouteAction }> {
  const out = new Map<string, { match: string; by: RouteAction }>();
  const seen = new Map<string, RouteAction>();
  const pass = (action: RouteAction) => {
    for (const rule of rules) {
      if (rule.action !== action || rule.match.length === 0) continue;
      const hit = rule.match.find((m) => seen.has(m));
      if (hit !== undefined) {
        out.set(rule.id, { match: hit, by: seen.get(hit)! });
        continue;
      }
      for (const m of rule.match) seen.set(m, action);
    }
  };
  pass('block');
  pass('direct');
  return out;
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */
