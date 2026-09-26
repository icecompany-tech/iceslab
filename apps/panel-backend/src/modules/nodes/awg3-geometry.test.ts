import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AwgGeometry3 } from '@iceslab/shared';
import { awg3GeometryViolations, mintAwg3Geometry, type GeometryRandom } from './awg3-geometry.js';

/**
 * The 3.1 geometry the panel mints per node (t07-6), held to the agent's
 * table (geometry3.go) under the same rule ids.
 *
 * FIXTURE is minted here with a seeded draw and read by the agent's test
 * (TestTheGeometryThePanelMintsIsOneTheAgentRenders): a change to either table
 * that makes them disagree fails one side or the other. Regenerate with
 * UPDATE_AWG3_FIXTURE=1 after a deliberate change to the draw.
 */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../node/internal/core/amneziawg/testdata/geometry3-minted.json',
);

/** mulberry32: a small deterministic draw, for the fixture only. */
function seeded(seed: number): GeometryRandom {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    bytes: (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(next() * 256))),
  };
}

const valid = (): AwgGeometry3 => mintAwg3Geometry(seeded(7));

describe('minting', () => {
  it('every draw passes the table', () => {
    for (let i = 0; i < 500; i++) {
      const g = mintAwg3Geometry();
      expect(awg3GeometryViolations(g), JSON.stringify(g)).toEqual([]);
    }
  });

  it('no two nodes share the shape a classifier would learn', () => {
    const a = mintAwg3Geometry();
    const b = mintAwg3Geometry();
    expect(a.headerProtectionKey).not.toBe(b.headerProtectionKey);
    expect([a.h1, a.h2, a.h3, a.h4]).not.toEqual([b.h1, b.h2, b.h3, b.h4]);
  });

  it('writes no stock decoy: I1 is ours, and RandomTrailers is on everywhere', () => {
    for (let i = 0; i < 50; i++) {
      const g = mintAwg3Geometry();
      expect(g.i1).not.toBe('');
      // The stock Amnezia decoy is a DNS response and an icloud.com packet.
      expect(g.i1 + g.i2 + g.i3).not.toMatch(/69636c6f7564/i);
      expect(g.randomTrailers).toBe(true);
    }
  });

  it('the fixture the agent reads is what this minter draws', () => {
    const minted = Array.from({ length: 8 }, (_, i) => mintAwg3Geometry(seeded(1000 + i)));
    if (process.env.UPDATE_AWG3_FIXTURE === '1') writeFileSync(FIXTURE, `${JSON.stringify(minted, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(minted);
  });
});

describe('the table, one case per rule, each breaking that rule alone', () => {
  const cases: [string, (g: AwgGeometry3) => void][] = [
    ['hpk-required', (g) => (g.headerProtectionKey = '')],
    ['s-nonce-floor', (g) => (g.s3 = 11)],
    ['scalar-uint16', (g) => (g.jc = 70000)],
    ['range-uint16', (g) => (g.maxHandshakeAttempts = '12-70000')],
    ['range-order', (g) => (g.rekeyTimeout = '6-4')],
    ['mtu-range', (g) => ((g.mtu = 1200), (g.s4 = 12))],
    ['s4-mtu-budget', (g) => ((g.mtu = 1420), (g.s4 = 30))],
    ['class-sizes-distinct', (g) => (g.s2 = g.s1 + 56)],
    ['junk-order', (g) => (g.jmax = g.jmin)],
    ['junk-ceiling', (g) => ((g.jmin = 900), (g.jmax = 1001))],
    ['header-bounds', (g) => (g.h1 = '3')],
    ['headers-disjoint', (g) => (g.h2 = g.h1)],
    ['content-padding-set', (g) => (g.contentPaddingAddition = '0-32')],
    ['timings-set', (g) => (g.rekeyTimeout = '0')],
    ['reject-floor', (g) => (g.rejectAfterTime = '170-179')],
    ['reject-after-keepalive', (g) => (g.keepaliveTimeout = '100-250')],
    ['rekey-before-reject', (g) => (g.rekeyAfterTime = '150-210')],
    ['random-trailers-on', (g) => ((g as { randomTrailers: boolean }).randomTrailers = false)],
    ['i1-present', (g) => (g.i1 = '')],
    ['i-charset', (g) => (g.i2 = 'aa\nPostUp = x')],
  ];
  it.each(cases)('%s', (id, breakIt) => {
    const g = valid();
    // Keep the packet classes distinct whatever a case moves.
    breakIt(g);
    const v = awg3GeometryViolations(g);
    expect(v).toContain(id);
  });

  it('a string the tools cannot read is refused whole', () => {
    const g = valid();
    g.rejectAfterTime = 'soon';
    expect(awg3GeometryViolations(g)).toEqual(['unparsable']);
  });
});
