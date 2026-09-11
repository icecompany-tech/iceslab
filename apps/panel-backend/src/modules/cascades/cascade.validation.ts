import {
  MAX_CASCADE_HOPS,
  MAX_CASCADE_LINKS,
  MAX_CASCADE_PATH,
  MAX_CASCADE_POSITIONS,
} from './cascade.schemas.js';
import type {
  CascadeDirectionInput,
  CascadeHopInput,
  CascadePositionInput,
} from './cascade.schemas.js';
import { linkCellFor } from './cascade.config.js';

/**
 * A link protocol nothing can carry is refused here, at the save.
 *
 * It used to be accepted and quietly turned into a vless link: the operator
 * chose hysteria, the node built vless, the panel showed hysteria, and the
 * cascade worked, which is what made it invisible. The list of what IS carried
 * lives in cascade.config.ts; the message names the value so the operator reads
 * their own choice back rather than a rule number.
 */
function assertLinkCellExists(protocol: string | null | undefined, where: string): void {
  if (linkCellFor(protocol)) return;
  throw new CascadeValidationError(
    `${where}: ${JSON.stringify(protocol)} is not an inter-hop link protocol this build can ` +
      `carry. Available: vless (also stored as "xray") and shadowsocks. A hop link is not the ` +
      `same thing as the protocol the entry serves users with.`,
  );
}

export class CascadeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CascadeValidationError';
  }
}

export interface ValidatedTopology {
  positions: CascadePositionInput[];
  directions: CascadeDirectionInput[];
  /** Number of node-to-node links this topology implies. */
  linkCount: number;
}

/**
 * Validate and normalise a cascade's topology for the v4 storage model. Pure
 * (no DB) so the rules stay unit-testable.
 *
 * v4 collapses the chain/balancer split: there is no `mode`, the shape falls
 * out of the contents, and one set of rules holds for all of them.
 *   - one entry (position 0) plus optional transits, contiguous 0..N-1;
 *   - `entryProtocol` only on the entry, and required there;
 *   - EVERY position carries a `linkProtocol`, because none of them is
 *     terminal: each leads either to the next position or to the directions.
 *     This is the rule that used to differ per mode and made `position` mean
 *     two things at once (last-is-exit for chains, any-non-zero-is-exit for
 *     balancers), which is what silently renumbered tags on delete;
 *   - at least one direction, since a cascade with no way out serves nobody;
 *   - a node appears at most once across positions AND directions together: the
 *     same machine as both a transit and an exit would route traffic into
 *     itself;
 *   - the path (positions plus the direction step) fits MAX_CASCADE_PATH;
 *   - the implied link count fits MAX_CASCADE_LINKS.
 *
 * A direction with an EMPTY pool is allowed on purpose, see the schema.
 */
export function validateCascadeTopology(
  positions: CascadePositionInput[],
  directions: CascadeDirectionInput[],
): ValidatedTopology {
  if (positions.length < 1) {
    throw new CascadeValidationError('a cascade needs an entry position');
  }
  if (positions.length > MAX_CASCADE_POSITIONS) {
    throw new CascadeValidationError(
      `a cascade can have at most ${MAX_CASCADE_POSITIONS} positions (got ${positions.length})`,
    );
  }
  if (directions.length < 1) {
    throw new CascadeValidationError(
      'a cascade needs at least one direction: without one, a client has nowhere to exit',
    );
  }
  if (positions.length + 1 > MAX_CASCADE_PATH) {
    throw new CascadeValidationError(
      `the path is capped at ${MAX_CASCADE_PATH} steps including the direction`,
    );
  }

  const sorted = [...positions].sort((a, b) => a.position - b.position);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.position !== i) {
      throw new CascadeValidationError(
        `positions must be contiguous 0..${sorted.length - 1} (got ${sorted
          .map((p) => p.position)
          .join(',')})`,
      );
    }
  }

  sorted.forEach((p, i) => {
    const isEntry = i === 0;
    if (isEntry && !p.entryProtocol) {
      throw new CascadeValidationError('the entry position needs an entryProtocol');
    }
    if (!isEntry && p.entryProtocol) {
      throw new CascadeValidationError(
        `entryProtocol is only valid on the entry, not position ${p.position}`,
      );
    }
    if (!p.linkProtocol) {
      throw new CascadeValidationError(
        `position ${p.position} needs a linkProtocol (it links to ${
          i === sorted.length - 1 ? 'the directions' : 'the next position'
        })`,
      );
    }
    assertLinkCellExists(p.linkProtocol, `position ${p.position}`);
    if (p.nodeIds.length === 0) {
      throw new CascadeValidationError(`position ${p.position} needs at least one node`);
    }
    if (new Set(p.nodeIds).size !== p.nodeIds.length) {
      throw new CascadeValidationError(`position ${p.position} lists the same node twice`);
    }
  });

  for (const d of directions) {
    if (new Set(d.nodeIds).size !== d.nodeIds.length) {
      throw new CascadeValidationError('a direction lists the same node twice');
    }
  }

  const seen = new Set<string>();
  for (const nodeId of [
    ...sorted.flatMap((p) => p.nodeIds),
    ...directions.flatMap((d) => d.nodeIds),
  ]) {
    if (seen.has(nodeId)) {
      throw new CascadeValidationError('a node cannot appear more than once in a cascade');
    }
    seen.add(nodeId);
  }

  const linkCount = countLinks(sorted, directions);
  if (linkCount > MAX_CASCADE_LINKS) {
    throw new CascadeValidationError(
      `this shape needs ${linkCount} links, over the ${MAX_CASCADE_LINKS} cap. Each pair of nodes on adjacent steps is one link with its own listener and secret, so pools multiply.`,
    );
  }

  return { positions: sorted, directions, linkCount };
}

/**
 * Links implied by a topology: every node on a step pairs with every node on
 * the next. Exported so the UI can show the count before saving, which is where
 * the multiplication becomes visible ("1 entry x 3 directions = 3").
 */
export function countLinks(
  positions: CascadePositionInput[],
  directions: CascadeDirectionInput[],
): number {
  let total = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    total += positions[i]!.nodeIds.length * positions[i + 1]!.nodeIds.length;
  }
  const last = positions[positions.length - 1];
  if (last) {
    for (const d of directions) total += last.nodeIds.length * d.nodeIds.length;
  }
  return total;
}

/**
 * Fold the redesigned positions/directions payload into the stored hop list.
 *
 * The panel now thinks in positions (a step holding a pool) and directions (a
 * way out with a frozen tag); storage still thinks in single-node hops. Every
 * shape E1 shipped survives the fold:
 *
 *   one entry + one direction   -> chain   (entry, exit)
 *   one entry + N directions    -> balancer (entry, N parallel exits)
 *   entry + transits + one direction -> chain of that length
 *
 * Two shapes do not survive, and both are refused by name rather than mangled:
 * a POOL (several nodes on one step) has nowhere to go, and transits combined
 * with several directions were never representable here at all. Guessing would
 * be worse than refusing: silently dropping the second node of a pool would
 * leave an operator convinced of redundancy they do not have.
 */
export function foldPositionsIntoHops(
  positions: CascadePositionInput[],
  directions: CascadeDirectionInput[],
): { hops: CascadeHopInput[]; mode: 'chain' | 'balancer' } {
  const sorted = [...positions].sort((a, b) => a.position - b.position);

  for (const p of sorted) {
    if (p.nodeIds.length > 1) {
      throw new CascadeValidationError(
        `position ${p.position} lists ${p.nodeIds.length} nodes. A pool on a position needs the new cascade storage; today a position holds exactly one node.`,
      );
    }
  }
  for (const d of directions) {
    if (d.nodeIds.length > 1) {
      throw new CascadeValidationError(
        `a direction lists ${d.nodeIds.length} nodes. A pool behind a direction needs the new cascade storage; today a direction is one node.`,
      );
    }
  }
  if (directions.length > 1 && sorted.length > 1) {
    throw new CascadeValidationError(
      'transits together with several directions cannot be stored yet: pick either one way out with transits, or several ways out straight from the entry.',
    );
  }

  const mode: 'chain' | 'balancer' = directions.length > 1 ? 'balancer' : 'chain';
  const entry = sorted[0]!;
  const hops: CascadeHopInput[] = [
    {
      nodeId: entry.nodeIds[0]!,
      position: 0,
      ...(entry.entryProtocol ? { entryProtocol: entry.entryProtocol } : {}),
      ...(entry.linkProtocol ? { linkProtocol: entry.linkProtocol } : {}),
    },
  ];

  if (mode === 'balancer') {
    // Exits hang straight off the entry; the entry carries the one uniform
    // link protocol and the exits carry none.
    directions.forEach((d, i) => {
      hops.push({ nodeId: d.nodeIds[0]!, position: i + 1 });
    });
    return { hops, mode };
  }

  // Chain: transits keep their own link protocol, the single direction becomes
  // the terminal hop and carries none.
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i]!;
    hops.push({
      nodeId: p.nodeIds[0]!,
      position: i,
      ...(p.linkProtocol ? { linkProtocol: p.linkProtocol } : {}),
    });
  }
  hops.push({ nodeId: directions[0]!.nodeIds[0]!, position: sorted.length });
  return { hops, mode };
}

/**
 * Validate + normalise a cascade's hops. Pure (no DB) so the topology rules are
 * unit-testable. Returns the hops sorted by position. Rules common to both modes:
 *   - at least 2 hops (entry + exit(s)), at most MAX_CASCADE_HOPS;
 *   - positions are exactly 0..N-1, unique;
 *   - `entryProtocol` is set ONLY on the entry hop (position 0), and required there;
 *   - a node may not appear twice in one cascade (no loops).
 *
 * `linkProtocol` placement is mode-specific:
 *   - chain:    the sequential entry->...->exit path. Every NON-exit hop carries
 *               the link to the next hop; the single exit omits it (egresses direct).
 *   - balancer: one entry fanning out to N parallel exits. The ENTRY carries the
 *               one (uniform) exit-link protocol; every exit (position >=1) omits
 *               it and egresses direct. Cred generation reads hops[0].linkProtocol
 *               for all exit links, so a per-exit linkProtocol would be silently
 *               ignored: reject it rather than accept a misleading config.
 */
export function validateCascadeHops(
  hops: CascadeHopInput[],
  mode: 'chain' | 'balancer' = 'chain',
): CascadeHopInput[] {
  if (hops.length < 2) {
    throw new CascadeValidationError('a cascade needs at least 2 hops (entry + exit)');
  }
  if (hops.length > MAX_CASCADE_HOPS) {
    throw new CascadeValidationError(
      `a cascade can have at most ${MAX_CASCADE_HOPS} hops (got ${hops.length})`,
    );
  }

  const sorted = [...hops].sort((a, b) => a.position - b.position);

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.position !== i) {
      throw new CascadeValidationError(
        `hop positions must be contiguous 0..${sorted.length - 1} (got ${sorted.map((h) => h.position).join(',')})`,
      );
    }
  }

  const lastIdx = sorted.length - 1;
  const isBalancer = mode === 'balancer';
  sorted.forEach((h, i) => {
    const isEntry = i === 0;
    // chain: the single last hop is the exit. balancer: every hop past the entry
    // (position >=1) is a parallel exit.
    const isExit = isBalancer ? i >= 1 : i === lastIdx;
    if (isEntry && !h.entryProtocol) {
      throw new CascadeValidationError('the entry hop (position 0) needs an entryProtocol');
    }
    if (!isEntry && h.entryProtocol) {
      throw new CascadeValidationError(
        `entryProtocol is only valid on the entry hop, not position ${h.position}`,
      );
    }
    // A hop that carries a link to a downstream node needs a linkProtocol; a
    // terminal exit must not. chain: links live on every non-exit hop. balancer:
    // the entry carries the one (uniform) exit-link protocol, exits carry none.
    const carriesLink = isBalancer ? isEntry : !isExit;
    if (carriesLink && !h.linkProtocol) {
      throw new CascadeValidationError(
        isBalancer
          ? 'the entry hop needs a linkProtocol (the uniform protocol for every exit link)'
          : `hop at position ${h.position} needs a linkProtocol (only the exit hop omits it)`,
      );
    }
    if (carriesLink) {
      assertLinkCellExists(h.linkProtocol, `hop at position ${h.position}`);
    }
    if (!carriesLink && h.linkProtocol) {
      throw new CascadeValidationError(
        isBalancer
          ? `balancer exits egress direct and must not have a linkProtocol (position ${h.position})`
          : 'the exit hop egresses direct and must not have a linkProtocol',
      );
    }
  });

  const nodeIds = sorted.map((h) => h.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new CascadeValidationError('a node cannot appear more than once in a cascade');
  }

  return sorted;
}
