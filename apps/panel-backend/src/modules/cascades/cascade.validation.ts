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
 * unit-testable. Returns the hops sorted by position. Rules:
 *   - at least 2 hops (entry + exit), at most MAX_CASCADE_HOPS;
 *   - positions are exactly 0..N-1, unique;
 *   - `entryProtocol` is set ONLY on the entry hop (position 0), and required there;
 *   - `linkProtocol` is set on every NON-exit hop and absent on the exit hop
 *     (the exit egresses direct);
 *   - a node may not appear twice in one cascade (no loops).
 */
export function validateCascadeHops(hops: CascadeHopInput[]): CascadeHopInput[] {
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
  sorted.forEach((h, i) => {
    const isEntry = i === 0;
    const isExit = i === lastIdx;
    if (isEntry && !h.entryProtocol) {
      throw new CascadeValidationError('the entry hop (position 0) needs an entryProtocol');
    }
    if (!isEntry && h.entryProtocol) {
      throw new CascadeValidationError(
        `entryProtocol is only valid on the entry hop, not position ${h.position}`,
      );
    }
    if (!isExit && !h.linkProtocol) {
      throw new CascadeValidationError(
        `hop at position ${h.position} needs a linkProtocol (only the exit hop omits it)`,
      );
    }
    if (isExit && h.linkProtocol) {
      throw new CascadeValidationError('the exit hop egresses direct and must not have a linkProtocol');
    }
  });

  const nodeIds = sorted.map((h) => h.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new CascadeValidationError('a node cannot appear more than once in a cascade');
  }

  return sorted;
}
