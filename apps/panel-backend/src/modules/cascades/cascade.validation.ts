import { MAX_CASCADE_HOPS } from './cascade.schemas.js';
import type { CascadeHopInput } from './cascade.schemas.js';

export class CascadeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CascadeValidationError';
  }
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
 *   - chain:    the sequential entry->…->exit path — every NON-exit hop carries
 *               the link to the next hop; the exit omits it (egresses direct).
 *   - balancer: one entry fanning out to N parallel exits — the ENTRY carries the
 *               (uniform) exit-link protocol; every exit (position ≥1) omits it and
 *               egresses direct. Cred generation reads hops[0].linkProtocol for all
 *               exit links, so a per-exit linkProtocol would be silently ignored —
 *               reject it instead of accepting a misleading config.
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
    // (position ≥1) is a parallel exit.
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
