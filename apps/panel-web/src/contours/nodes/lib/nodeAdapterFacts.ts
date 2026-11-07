import type { UserScopeGap } from '@iceslab/shared';
import { awgLabel } from '@/lib/old/awg';
import { protocolLabelCompact } from '@/lib/old/protocols';

type T = (key: string, vars?: Record<string, unknown>) => string;

/**
 * The slot named in words. For AmneziaWG the server puts the GENERATION in
 * `engine` ('1' | '3'), not an engine: «AmneziaWG 3.1», as the other screens
 * name it (awgLabel), never «amneziawg on 3». Any other slot is the protocol
 * on its engine.
 */
export function slotLabel(protocol: string, engine: string, t: T): string {
  if (protocol === 'amneziawg') {
    const generation = engine === '3' ? awgLabel(3) : engine === '1' ? awgLabel(1) : engine;
    return `${protocolLabelCompact(protocol)} ${generation}`;
  }
  // The engine by its own name («xray», «sing-box»): the core words of the
  // other screens («ядро xray») do not fit after «на».
  return t('nodeEdit.slotPair', { protocol: protocolLabelCompact(protocol), engine: engine === 'singbox' ? 'sing-box' : engine });
}

/** Every gap the contract names: a Record over the shared union, so a new
 *  member is a type error here rather than a gap silently skipped. */
const KNOWN_GAPS: Record<UserScopeGap, true> = { 'shared-secret': true, 'shared-users': true };

type Served = { profileName: string; port: number };

/**
 * A-195: profiles that share a single-inbound adapter on this node. The node
 * serves one of them (`served`), the rest do not work but are handed out in
 * the subscription. `null`: the server is older than the field, say nothing;
 * `[]`: none. The input is checked first; a malformed entry is skipped.
 */
export function slotConflictsOf(
  raw: unknown,
): { protocol: string; engine: string; served: Served | null; others: Served[] }[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: { protocol: string; engine: string; served: Served | null; others: Served[] }[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const { protocol, engine, bindings, servedBindingId } = c as {
      protocol?: unknown;
      engine?: unknown;
      bindings?: unknown;
      servedBindingId?: unknown;
    };
    // The slot is the pair (protocol, engine): shadowsocks on xray and on
    // sing-box are two adapters, so the engine is part of the fact.
    if (typeof protocol !== 'string' || typeof engine !== 'string' || !Array.isArray(bindings)) continue;
    const rows = bindings.filter(
      (b): b is { bindingId: string; profileName: string; port: number } =>
        !!b &&
        typeof b === 'object' &&
        typeof (b as { bindingId?: unknown }).bindingId === 'string' &&
        typeof (b as { profileName?: unknown }).profileName === 'string' &&
        typeof (b as { port?: unknown }).port === 'number',
    );
    // Fewer than two well-formed bindings left is no conflict to name.
    if (rows.length < 2) continue;
    const served = rows.find((b) => b.bindingId === servedBindingId) ?? null;
    out.push({
      protocol,
      engine,
      served: served ? { profileName: served.profileName, port: served.port } : null,
      others: rows.filter((b) => b !== served).map((b) => ({ profileName: b.profileName, port: b.port })),
    });
  }
  return out;
}

/**
 * A-204: bindings on this node where a squad's limit on a user does not hold,
 * with why. `null`: the server is older than the field; `[]`: none. The input
 * is checked first; a gap the contract does not name is skipped.
 */
export function userScopeGapsOf(raw: unknown): { profileName: string; port: number; gap: UserScopeGap }[] | null {
  if (raw === undefined || !Array.isArray(raw)) return null;
  return raw.flatMap((g) => {
    if (!g || typeof g !== 'object') return [];
    const { profileName, port, gap } = g as { profileName?: unknown; port?: unknown; gap?: unknown };
    if (typeof profileName !== 'string' || typeof port !== 'number' || typeof gap !== 'string') return [];
    if (!Object.hasOwn(KNOWN_GAPS, gap)) return [];
    return [{ profileName, port, gap: gap as UserScopeGap }];
  });
}
