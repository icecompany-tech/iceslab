import { LINK_CONGESTIONS, type LinkCongestion } from '@iceslab/shared';

/**
 * The leg knobs a stored direction carries, as far as they can be believed.
 *
 * jsonb is not a type: the column can hold an array, a number, a string or a
 * `congestion` that is itself an object, and Prisma types all of it as
 * JsonValue. Anything that is not a knob this build knows reads as "no knobs",
 * because the alternative is carrying it into a save or onto a screen as
 * though somebody had chosen it.
 *
 * ONE reader, used by the merge (which writes the value back) and by the mapper
 * (which sends it to the panel). Two readers of one column is how a value
 * survives a round trip on the screen and disappears on the next save.
 */
export function storedLinkParams(raw: unknown): { congestion?: LinkCongestion } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const congestion = (raw as { congestion?: unknown }).congestion;
  return (LINK_CONGESTIONS as readonly unknown[]).includes(congestion)
    ? { congestion: congestion as LinkCongestion }
    : null;
}

/**
 * What the panel already has for a direction, as far as merging cares.
 *
 * Structural rather than the Prisma row: the two callers select different
 * columns, and a type naming the model would drag the whole row through a file
 * whose job is one rule.
 */
export interface StoredDirection {
  id: string;
  nodes: { nodeId: string }[];
}

/** A direction as it arrived, with every field allowed to be absent. */
export interface IncomingDirection {
  id?: string;
  nodeIds?: string[];
  countryCode?: string | null;
  linkProtocol?: string | null;
  linkParams?: { congestion?: LinkCongestion } | null;
}

/** The same direction with nothing left unsaid. */
export interface ResolvedDirection {
  id?: string;
  nodeIds: string[];
  countryCode?: string | null;
  linkProtocol?: string | null;
  linkParams?: { congestion?: LinkCongestion } | null;
}

/**
 * Which stored direction each incoming one IS, one rule in one place.
 *
 * Two ways to match, in this order and for different reasons:
 *   - by `id`, which is what a client sends back after a save and the only
 *     exact answer;
 *   - by POOL, compared as a set, because the panel did not always send ids and
 *     a stored direction has to be recognised anyway. Without it every save
 *     would burn fresh tags, and a tag rides in the clients' UUIDs: the country
 *     they exit through would move under them.
 *
 * Each stored direction is claimed at most once, so two incoming directions
 * with the same pool cannot both become the same row.
 *
 * Returns one entry per incoming direction, in order, `undefined` where nothing
 * matched. The caller decides what that means: for the merge it means there is
 * nothing to carry forward, for the writer it means a new tag.
 */
export function matchStoredDirections<S extends StoredDirection>(
  stored: S[],
  incoming: readonly IncomingDirection[],
): (S | undefined)[] {
  const byId = new Map(stored.map((d) => [d.id, d]));
  const unclaimed = new Set(stored.map((d) => d.id));
  return incoming.map((d) => {
    let match = d.id ? byId.get(d.id) : undefined;
    if (!match && d.nodeIds && d.nodeIds.length > 0) {
      // Compared as a set: reordering the pool in the UI must not look like a
      // different way out.
      const want = new Set(d.nodeIds);
      match = stored.find(
        (s) =>
          unclaimed.has(s.id) &&
          s.nodes.length === want.size &&
          s.nodes.every((n) => want.has(n.nodeId)),
      );
    }
    if (match && unclaimed.has(match.id)) {
      unclaimed.delete(match.id);
      return match;
    }
    return undefined;
  });
}

/**
 * Fill in what the client did not mention, from what is stored.
 *
 * ⚠ The whole point is the difference between a key that is ABSENT and a key
 * whose value is `null`, and the difference is not symmetric:
 *
 *   - absent  the client is not editing this. The stored value is carried
 *             forward, untouched, whatever it is;
 *   - null    the client is editing this to nothing. For `linkProtocol` that
 *             means "the entry's cell", for `countryCode` no country, and both
 *             are values an operator can choose on purpose;
 *   - value   the client is editing this to that.
 *
 * `in` and not a truthiness test, for the same reason: `'linkProtocol' in d` is
 * true for a key set to null and false for a key nobody sent, which is exactly
 * the question. A `??` here would collapse the first two and put us back where
 * the bug was.
 *
 * The pool is merged by the same rule, and it is the field that hurts most: a
 * PUT that does not mention `nodeIds` used to empty the direction, which stops
 * it serving without deleting it, so nothing on the screen said anything had
 * happened.
 */
export function resolveDirections<S extends StoredDirection>(
  stored: S[],
  incoming: readonly IncomingDirection[],
  read: (s: S) => Omit<ResolvedDirection, 'id' | 'nodeIds'>,
): ResolvedDirection[] {
  const matches = matchStoredDirections(stored, incoming);
  return incoming.map((d, i) => {
    const match = matches[i];
    const kept = match ? read(match) : {};
    return {
      // Carried forward so the writer matches the same row exactly rather than
      // by pool: after this merge the pool may be the stored one, and matching
      // on it twice by two rules is how the two could disagree.
      ...(match ? { id: match.id } : d.id ? { id: d.id } : {}),
      nodeIds: d.nodeIds ?? match?.nodes.map((n) => n.nodeId) ?? [],
      countryCode: 'countryCode' in d ? d.countryCode : kept.countryCode,
      linkProtocol: 'linkProtocol' in d ? d.linkProtocol : kept.linkProtocol,
      linkParams: 'linkParams' in d ? d.linkParams : kept.linkParams,
    };
  });
}
