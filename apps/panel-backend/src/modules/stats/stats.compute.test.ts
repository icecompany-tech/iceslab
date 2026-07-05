import { describe, it, expect } from 'vitest';
import {
  computeNodeStatsWrites,
  computeUserDeltas,
  type UserSnapshot,
} from './stats.compute.js';

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

  // Regression: a node reporting the same user twice (multiple inbounds on one
  // node) used to make the bulk unnest upsert hit Postgres 21000 ("ON CONFLICT
  // DO UPDATE command cannot affect row a second time"). Aggregate by userId so
  // the unnest array has unique keys; the summed bytes match the old per-entry
  // increment loop.
  it('aggregates duplicate userIds into one row (multi-inbound on one node)', () => {
    const w = computeNodeStatsWrites({
      users: [
        { userId: 'u1', bytesIn: 100, bytesOut: 50 }, // vless inbound
        { userId: 'u1', bytesIn: 20, bytesOut: 5 }, // trojan inbound, same user
        { userId: 'u2', bytesIn: 10, bytesOut: 0 },
      ],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
    });
    expect(w.userTrafficRows).toEqual([
      { userId: 'u1', scaled: 175n }, // (150) + (25)
      { userId: 'u2', scaled: 10n },
    ]);
    expect(w.historyRows).toEqual([
      { userId: 'u1', bytesIn: 120n, bytesOut: 55n },
      { userId: 'u2', bytesIn: 10n, bytesOut: 0n },
    ]);
    expect(w.nodeUpload).toBe(130n); // 100+20+10 raw
    expect(w.nodeDownload).toBe(55n); // 50+5+0 raw
  });

  it('sums scaled-per-entry for a duplicated user under a multiplier', () => {
    const w = computeNodeStatsWrites({
      users: [
        { userId: 'u1', bytesIn: 3, bytesOut: 0 },
        { userId: 'u1', bytesIn: 4, bytesOut: 0 },
      ],
      multiplier: 2,
      isPresenceOnlyProtocol: false,
    });
    // scale(3)+scale(4) = 6+8 = 14 (matches the old two-increment behaviour)
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 14n }]);
  });

  // Regression guard for the runaway AWG accounting bug as seen from the panel
  // side: a node-agent built before the per-poll-delta fix re-sends its whole
  // lifetime cumulative every 30s poll. The panel must refuse to ingest a
  // physically-impossible per-user delta rather than write phantom TiB into the
  // user's quota and node history.
  it('discards a per-user delta above the sanity ceiling and reports it', () => {
    const TiB = 1024 ** 4;
    const w = computeNodeStatsWrites({
      users: [
        { userId: 'sane', bytesIn: 1000, bytesOut: 500 },
        { userId: 'runaway', bytesIn: 250 * TiB, bytesOut: 0 }, // re-billed lifetime
      ],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      maxUserDeltaBytes: TiB,
    });
    // sane user billed normally; runaway dropped from every accumulator
    expect(w.userTrafficRows).toEqual([{ userId: 'sane', scaled: 1500n }]);
    expect(w.historyRows).toEqual([{ userId: 'sane', bytesIn: 1000n, bytesOut: 500n }]);
    expect(w.nodeUpload).toBe(1000n);
    expect(w.nodeDownload).toBe(500n);
    expect(w.clamped).toEqual([{ userId: 'runaway', bytesIn: 250 * TiB, bytesOut: 0 }]);
  });

  it('no ceiling set: nothing is clamped (back-compat)', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 9_999_999_999_999, bytesOut: 0 }],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
    });
    expect(w.clamped).toEqual([]);
    expect(w.nodeUpload).toBe(9_999_999_999_999n);
  });

  it('dedups presence-only touches and never duplicates a billed user', () => {
    const w = computeNodeStatsWrites({
      users: [
        { userId: 'u1', bytesIn: 0, bytesOut: 0 }, // zero on one inbound
        { userId: 'u1', bytesIn: 5, bytesOut: 0 }, // bytes on another
        { userId: 'u2', bytesIn: 0, bytesOut: 0 }, // pure presence
        { userId: 'u2', bytesIn: 0, bytesOut: 0 }, // duplicate presence
      ],
      multiplier: 1,
      isPresenceOnlyProtocol: true,
    });
    // u1 is billed once (not also a presence touch); u2 is a single zero touch.
    expect(w.userTrafficRows).toEqual([
      { userId: 'u1', scaled: 5n },
      { userId: 'u2', scaled: 0n },
    ]);
    expect(w.historyRows).toEqual([{ userId: 'u1', bytesIn: 5n, bytesOut: 0n }]);
  });

  // nodeTotalIsCumulative (xray): node-level history comes from the cumulative
  // inbound-counter delta, decoupled from the per-user sum, so a cascade link-in
  // (traffic with no per-user email) is counted while billing stays per-user.
  it('cumulative node total: node history from inbound delta, per-user billed separately', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 100, bytesOut: 50 }], // already a per-poll delta
      multiplier: 2,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 5000, // cumulative inbound counter
      totalBytesOut: 2000,
      prevSnapshot: { in: 4200n, out: 1500n },
      nodeTotalIsCumulative: true,
    });
    // per-user billing unchanged (scaled by multiplier)
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 300n }]);
    expect(w.historyRows).toEqual([{ userId: 'u1', bytesIn: 200n, bytesOut: 100n }]);
    // node history is the inbound delta (5000-4200, 2000-1500), NOT the per-user
    // bytes (100/50) and NOT both summed.
    expect(w.nodeUpload).toBe(800n);
    expect(w.nodeDownload).toBe(500n);
    expect(w.newSnapshot).toEqual({ in: 5000n, out: 2000n });
  });

  it('cumulative node total counts a cascade exit relay with zero tracked users', () => {
    const w = computeNodeStatsWrites({
      users: [], // pure relay: no direct users, only the link-in inbound
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 700,
      totalBytesOut: 1200,
      prevSnapshot: { in: 200n, out: 200n },
      nodeTotalIsCumulative: true,
    });
    expect(w.userTrafficRows).toEqual([]);
    expect(w.nodeUpload).toBe(500n); // 700 - 200
    expect(w.nodeDownload).toBe(1000n); // 1200 - 200
    expect(w.newSnapshot).toEqual({ in: 700n, out: 1200n });
  });

  it('cumulative node total first sight baselines to zero (in-memory snapshot cleared on restart)', () => {
    const w = computeNodeStatsWrites({
      users: [],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 9_000_000, // big since-start lifetime counter
      totalBytesOut: 4_000_000,
      prevSnapshot: undefined, // first poll after a backend restart
      nodeTotalIsCumulative: true,
    });
    // no spike: baseline only, then the NEXT poll deltas correctly
    expect(w.nodeUpload).toBe(0n);
    expect(w.nodeDownload).toBe(0n);
    expect(w.newSnapshot).toEqual({ in: 9_000_000n, out: 4_000_000n });
  });

  it('cumulative node total re-baselines on a counter reset (xray restart)', () => {
    const w = computeNodeStatsWrites({
      users: [],
      multiplier: 1,
      isPresenceOnlyProtocol: false,
      totalBytesIn: 300,
      totalBytesOut: 0,
      prevSnapshot: { in: 10_000n, out: 0n },
      nodeTotalIsCumulative: true,
    });
    expect(w.nodeUpload).toBe(0n); // dropped below snapshot -> zero delta
    expect(w.newSnapshot).toEqual({ in: 300n, out: 0n }); // re-baselined
  });
});

describe('computeUserDeltas (#5 - non-destructive cumulative)', () => {
  const snap = (cumIn: bigint, cumOut: bigint): UserSnapshot => ({ cumIn, cumOut });

  // Regression: a node reporting the same userId twice (a user on vless +
  // shadowsocks on one node) made the snapshot upsert's unnest carry a
  // duplicate (node_id, user_id), which Postgres rejected with 21000 and rolled
  // back the node's entire stats transaction. Sum the duplicates into one.
  it('aggregates a duplicated userId into one delta + snapshot', () => {
    const r = computeUserDeltas(
      [
        { userId: 'u1', bytesIn: 100, bytesOut: 50 },
        { userId: 'u1', bytesIn: 20, bytesOut: 5 },
      ],
      new Map([['u1', snap(100n, 30n)]]),
    );
    expect(r.snapshots).toEqual([{ userId: 'u1', cumIn: 120n, cumOut: 55n }]);
    // delta = summed cumulative (120/55) - prev (100/30)
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 20, bytesOut: 25 }]);
  });

  it('first sight bills nothing and just baselines the snapshot', () => {
    const r = computeUserDeltas([{ userId: 'u1', bytesIn: 5000, bytesOut: 3000 }], new Map());
    // must NOT bill the whole cumulative-since-core-start counter to the user
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 0, bytesOut: 0 }]);
    expect(r.snapshots).toEqual([{ userId: 'u1', cumIn: 5000n, cumOut: 3000n }]);
  });

  it('bills the delta against the prior snapshot', () => {
    const r = computeUserDeltas(
      [{ userId: 'u1', bytesIn: 5200, bytesOut: 3100 }],
      new Map([['u1', snap(5000n, 3000n)]]),
    );
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 200, bytesOut: 100 }]);
    expect(r.snapshots).toEqual([{ userId: 'u1', cumIn: 5200n, cumOut: 3100n }]);
  });

  it('bills 0 and re-baselines when the counter drops below the snapshot', () => {
    const r = computeUserDeltas(
      [{ userId: 'u1', bytesIn: 40, bytesOut: 10 }],
      new Map([['u1', snap(5000n, 3000n)]]),
    );
    // A drop below the snapshot is a core restart or a partial report, not a
    // real per-poll delta. Bill 0 (matching the node-level path) so a residual
    // cumulative never spikes the user's quota; re-baseline to the new value.
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 0, bytesOut: 0 }]);
    expect(r.snapshots).toEqual([{ userId: 'u1', cumIn: 40n, cumOut: 10n }]);
  });

  it('a failed tick loses nothing: next poll re-derives from the un-advanced baseline', () => {
    // Caller persists the snapshot in the same transaction as the increments,
    // so a failed commit leaves the baseline un-advanced. Against that same
    // baseline, a later poll's delta re-includes every byte since it - contrast
    // the destructive -reset model, where the drained bytes were gone.
    const baseline = new Map([['u1', snap(100n, 0n)]]);
    const failedTick = computeUserDeltas([{ userId: 'u1', bytesIn: 250, bytesOut: 0 }], baseline);
    expect(failedTick.deltas[0]!.bytesIn).toBe(150); // would have billed 150, but commit failed
    const nextTick = computeUserDeltas([{ userId: 'u1', bytesIn: 400, bytesOut: 0 }], baseline);
    expect(nextTick.deltas[0]!.bytesIn).toBe(300); // 150 (lost tick) + 150 (this tick), nothing dropped
  });
});
