import { describe, it, expect } from 'vitest';
import { computeNodeStatsWrites } from './stats.compute.js';

describe('computeNodeStatsWrites (B3)', () => {
  it('scales per-user billing but leaves node totals raw', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 100, bytesOut: 50 }],
      multiplier: 2,
      isPresenceOnlyProtocol: false,
    });
    // used+lifetime increment = scale(150) = 300
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 300n }]);
    // direction split scaled
    expect(w.historyRows).toEqual([{ userId: 'u1', bytesIn: 200n, bytesOut: 100n }]);
    // node-level totals stay raw (unscaled)
    expect(w.nodeUpload).toBe(100n);
    expect(w.nodeDownload).toBe(50n);
    expect(w.newSnapshot).toBeNull();
  });

  it('multiplier 1 is a no-op (no float rounding)', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 7, bytesOut: 3 }],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
    });
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 10n }]);
    expect(w.historyRows[0]).toEqual({ userId: 'u1', bytesIn: 7n, bytesOut: 3n });
  });

  it('drops zero-delta users on non-presence protocols', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 0, bytesOut: 0 }],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
    });
    expect(w.userTrafficRows).toEqual([]);
    expect(w.historyRows).toEqual([]);
    expect(w.nodeUpload).toBe(0n);
    expect(w.nodeDownload).toBe(0n);
  });

  it('presence-only protocol emits a zero-increment touch, no history row', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 0, bytesOut: 0 }],
      multiplier: 1,
      isPresenceOnlyProtocol: true,
    });
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 0n }]);
    expect(w.historyRows).toEqual([]);
  });

  it('single-counter fallback rolls cumulative totals into a delta', () => {
    const w = computeNodeStatsWrites({
      users: [],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 1000,
      totalBytesOut: 400,
      prevSnapshot: { in: 600n, out: 100n },
    });
    expect(w.nodeUpload).toBe(400n); // 1000 - 600
    expect(w.nodeDownload).toBe(300n); // 400 - 100
    expect(w.newSnapshot).toEqual({ in: 1000n, out: 400n });
  });

  it('fallback re-baselines when the counter reset below the snapshot', () => {
    const w = computeNodeStatsWrites({
      users: [],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 200,
      totalBytesOut: 0,
      prevSnapshot: { in: 1000n, out: 0n },
    });
    expect(w.nodeUpload).toBe(0n); // counter dropped -> zero delta, not negative
    expect(w.nodeDownload).toBe(0n);
    expect(w.newSnapshot).toEqual({ in: 200n, out: 0n }); // re-baselined
  });

  it('per-user bytes suppress the cumulative fallback', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 10, bytesOut: 0 }],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 9999,
      totalBytesOut: 9999,
      prevSnapshot: { in: 0n, out: 0n },
    });
    // node totals come from the per-user bytes, not the cumulative counters
    expect(w.nodeUpload).toBe(10n);
    expect(w.nodeDownload).toBe(0n);
    expect(w.newSnapshot).toBeNull();
  });
});
