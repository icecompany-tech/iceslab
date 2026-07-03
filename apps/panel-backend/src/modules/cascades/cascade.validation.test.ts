import { describe, expect, it } from 'vitest';
import { validateCascadeHops, CascadeValidationError } from './cascade.validation.js';
import type { CascadeHopInput } from './cascade.schemas.js';

const N1 = '11111111-1111-1111-1111-111111111111';
const N2 = '22222222-2222-2222-2222-222222222222';
const N3 = '33333333-3333-3333-3333-333333333333';
const N4 = '44444444-4444-4444-4444-444444444444';
const N5 = '55555555-5555-5555-5555-555555555555';
const N6 = '66666666-6666-6666-6666-666666666666';

// A contiguous chain of `n` hops: entry(0) carries entryProtocol, every
// non-exit hop carries linkProtocol, the exit omits it.
function chain(nodeIds: string[]): CascadeHopInput[] {
  return nodeIds.map((nodeId, i) => ({
    nodeId,
    position: i,
    ...(i === 0 ? { entryProtocol: 'xray' as const } : {}),
    ...(i < nodeIds.length - 1 ? { linkProtocol: 'xray' as const } : {}),
  }));
}

// A valid 2-hop cascade: RU entry (xray) -> EU exit (direct).
function valid2(): CascadeHopInput[] {
  return [
    { nodeId: N1, position: 0, entryProtocol: 'xray', linkProtocol: 'xray' },
    { nodeId: N2, position: 1 },
  ];
}

describe('validateCascadeHops', () => {
  it('accepts a valid 2-hop entry->exit cascade and returns it sorted', () => {
    const out = validateCascadeHops([valid2()[1]!, valid2()[0]!]); // reversed input
    expect(out.map((h) => h.position)).toEqual([0, 1]);
    expect(out[0]!.nodeId).toBe(N1);
  });

  it('accepts a 3-hop entry->transit->exit chain', () => {
    const hops: CascadeHopInput[] = [
      { nodeId: N1, position: 0, entryProtocol: 'xray', linkProtocol: 'xray' },
      { nodeId: N2, position: 1, linkProtocol: 'shadowsocks' },
      { nodeId: N3, position: 2 },
    ];
    expect(() => validateCascadeHops(hops)).not.toThrow();
  });

  it('rejects fewer than 2 hops', () => {
    expect(() => validateCascadeHops([valid2()[0]!])).toThrow(CascadeValidationError);
  });

  it('accepts exactly 5 hops (the max)', () => {
    expect(() => validateCascadeHops(chain([N1, N2, N3, N4, N5]))).not.toThrow();
  });

  it('rejects more than 5 hops', () => {
    expect(() => validateCascadeHops(chain([N1, N2, N3, N4, N5, N6]))).toThrow(/at most/);
  });

  it('rejects non-contiguous positions', () => {
    const hops = valid2();
    hops[1]!.position = 2;
    expect(() => validateCascadeHops(hops)).toThrow(/contiguous/);
  });

  it('requires an entryProtocol on the entry hop', () => {
    const hops = valid2();
    delete hops[0]!.entryProtocol;
    expect(() => validateCascadeHops(hops)).toThrow(/entry hop/);
  });

  it('rejects entryProtocol on a non-entry hop', () => {
    const hops = valid2();
    hops[1]!.entryProtocol = 'xray';
    expect(() => validateCascadeHops(hops)).toThrow(/only valid on the entry hop/);
  });

  it('requires linkProtocol on a non-exit hop', () => {
    const hops = valid2();
    delete hops[0]!.linkProtocol;
    expect(() => validateCascadeHops(hops)).toThrow(/needs a linkProtocol/);
  });

  it('rejects linkProtocol on the exit hop', () => {
    const hops = valid2();
    hops[1]!.linkProtocol = 'xray';
    expect(() => validateCascadeHops(hops)).toThrow(/exit hop egresses direct/);
  });

  it('rejects a node appearing twice', () => {
    const hops = valid2();
    hops[1]!.nodeId = N1;
    expect(() => validateCascadeHops(hops)).toThrow(/more than once/);
  });
});

describe('validateCascadeHops (balancer mode)', () => {
  // A balancer: one entry (carries the uniform exit-link protocol) fanning out
  // to N parallel exits, none of which carry a linkProtocol.
  function balancer(exitCount: number): CascadeHopInput[] {
    const ids = [N1, N2, N3, N4, N5];
    return Array.from({ length: exitCount + 1 }, (_, i) => ({
      nodeId: ids[i]!,
      position: i,
      ...(i === 0 ? { entryProtocol: 'xray' as const, linkProtocol: 'xray' as const } : {}),
    }));
  }

  it('accepts an entry + 2 parallel exits (chain rule would reject the middle exit)', () => {
    expect(() => validateCascadeHops(balancer(2), 'balancer')).not.toThrow();
    // The SAME topology is invalid in chain mode: the middle hop (pos 1) needs a
    // linkProtocol there. This is exactly the mode-blind bug the fix closes.
    expect(() => validateCascadeHops(balancer(2), 'chain')).toThrow(/needs a linkProtocol/);
  });

  it('accepts a 2-hop balancer (entry + single exit)', () => {
    expect(() => validateCascadeHops(balancer(1), 'balancer')).not.toThrow();
  });

  it('requires a linkProtocol on the balancer entry', () => {
    const hops = balancer(2);
    delete hops[0]!.linkProtocol;
    expect(() => validateCascadeHops(hops, 'balancer')).toThrow(/entry hop needs a linkProtocol/);
  });

  it('rejects a linkProtocol on a balancer exit', () => {
    const hops = balancer(2);
    hops[1]!.linkProtocol = 'xray';
    expect(() => validateCascadeHops(hops, 'balancer')).toThrow(/exits egress direct/);
  });

  it('rejects entryProtocol on a balancer exit', () => {
    const hops = balancer(2);
    hops[2]!.entryProtocol = 'xray';
    expect(() => validateCascadeHops(hops, 'balancer')).toThrow(/only valid on the entry hop/);
  });
});
