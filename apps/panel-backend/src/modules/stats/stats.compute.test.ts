import { describe, it, expect } from 'vitest';
import {
  computeNodeStatsWrites,
  computeNodeTotalsFromCores,
  computeUserDeltas,
  snapshotKey,
  type StatsUserEntry,
  type UserSnapshot,
} from './stats.compute.js';

describe('computeNodeStatsWrites (B3)', () => {
  it('scales per-user billing but leaves node totals raw', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 100, bytesOut: 50 }],
      multiplier: 2,
    });
    // used+lifetime increment = scale(150) = 300
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 300n, hasActivity: true }]);
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
    });
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 10n, hasActivity: true }]);
    expect(w.historyRows[0]).toEqual({ userId: 'u1', bytesIn: 7n, bytesOut: 3n });
  });

  it('drops zero-delta users', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 0, bytesOut: 0 }],
      multiplier: 1,
    });
    expect(w.userTrafficRows).toEqual([]);
    expect(w.historyRows).toEqual([]);
    expect(w.nodeUpload).toBe(0n);
    expect(w.nodeDownload).toBe(0n);
  });

  it('A-121: an mtproto listing is not an online touch; the node answer for the whole roster writes nothing', () => {
    // mtg lists every user the panel sent it, connected or not.
    const roster = Array.from({ length: 1000 }, (_, i) => ({ userId: `u${i}`, bytesIn: 0, bytesOut: 0, protocol: 'mtproto' }));
    const w = computeNodeStatsWrites({ users: roster, multiplier: 1 });
    expect(w.userTrafficRows).toEqual([]);
    expect(w.historyRows).toEqual([]);
  });

  it('single-counter fallback rolls cumulative totals into a delta', () => {
    const w = computeNodeStatsWrites({
      users: [],
      multiplier: 1,
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
    });
    expect(w.userTrafficRows).toEqual([
      { userId: 'u1', scaled: 175n, hasActivity: true }, // (150) + (25)
      { userId: 'u2', scaled: 10n, hasActivity: true },
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
    });
    // scale(3)+scale(4) = 6+8 = 14 (matches the old two-increment behaviour)
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 14n, hasActivity: true }]);
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
      maxUserDeltaBytes: TiB,
    });
    // sane user billed normally; runaway dropped from every accumulator
    expect(w.userTrafficRows).toEqual([{ userId: 'sane', scaled: 1500n, hasActivity: true }]);
    expect(w.historyRows).toEqual([{ userId: 'sane', bytesIn: 1000n, bytesOut: 500n }]);
    expect(w.nodeUpload).toBe(1000n);
    expect(w.nodeDownload).toBe(500n);
    expect(w.clamped).toEqual([{ userId: 'runaway', bytesIn: 250 * TiB, bytesOut: 0 }]);
  });

  it('no ceiling set: nothing is clamped (back-compat)', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 9_999_999_999_999, bytesOut: 0 }],
      multiplier: 1,
    });
    expect(w.clamped).toEqual([]);
    expect(w.nodeUpload).toBe(9_999_999_999_999n);
  });

  it('bills a user once across inbounds, and writes nothing for one who moved nothing', () => {
    const w = computeNodeStatsWrites({
      users: [
        { userId: 'u1', bytesIn: 0, bytesOut: 0, protocol: 'mtproto' }, // listed on mtg
        { userId: 'u1', bytesIn: 5, bytesOut: 0, protocol: 'xray' }, // bytes on xray
        { userId: 'u2', bytesIn: 0, bytesOut: 0, protocol: 'mtproto' }, // listed only
        { userId: 'u2', bytesIn: 0, bytesOut: 0, protocol: 'mtproto' },
      ],
      multiplier: 1,
    });
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 5n, hasActivity: true }]);
    expect(w.historyRows).toEqual([{ userId: 'u1', bytesIn: 5n, bytesOut: 0n }]);
  });

  // nodeTotalIsCumulative (xray): node-level history comes from the cumulative
  // inbound-counter delta, decoupled from the per-user sum, so a cascade link-in
  // (traffic with no per-user email) is counted while billing stays per-user.
  it('cumulative node total: node history from inbound delta, per-user billed separately', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u1', bytesIn: 100, bytesOut: 50 }], // already a per-poll delta
      multiplier: 2,
      totalBytesIn: 5000, // cumulative inbound counter
      totalBytesOut: 2000,
      prevSnapshot: { in: 4200n, out: 1500n },
      nodeTotalIsCumulative: true,
    });
    // per-user billing unchanged (scaled by multiplier)
    expect(w.userTrafficRows).toEqual([{ userId: 'u1', scaled: 300n, hasActivity: true }]);
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
      new Map([['u1||', snap(100n, 30n)]]),
    );
    expect(r.snapshots).toEqual([{ userId: 'u1', protocol: '', engine: '', cumIn: 120n, cumOut: 55n }]);
    // delta = summed cumulative (120/55) - prev (100/30)
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 20, bytesOut: 25 }]);
  });

  it('first sight bills nothing and just baselines the snapshot', () => {
    const r = computeUserDeltas([{ userId: 'u1', bytesIn: 5000, bytesOut: 3000 }], new Map());
    // must NOT bill the whole cumulative-since-core-start counter to the user
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 0, bytesOut: 0 }]);
    expect(r.snapshots).toEqual([{ userId: 'u1', protocol: '', engine: '', cumIn: 5000n, cumOut: 3000n }]);
  });

  it('bills the delta against the prior snapshot', () => {
    const r = computeUserDeltas(
      [{ userId: 'u1', bytesIn: 5200, bytesOut: 3100 }],
      new Map([['u1||', snap(5000n, 3000n)]]),
    );
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 200, bytesOut: 100 }]);
    expect(r.snapshots).toEqual([{ userId: 'u1', protocol: '', engine: '', cumIn: 5200n, cumOut: 3100n }]);
  });

  it('bills 0 and re-baselines when the counter drops below the snapshot', () => {
    const r = computeUserDeltas(
      [{ userId: 'u1', bytesIn: 40, bytesOut: 10 }],
      new Map([['u1||', snap(5000n, 3000n)]]),
    );
    // A drop below the snapshot is a core restart or a partial report, not a
    // real per-poll delta. Bill 0 (matching the node-level path) so a residual
    // cumulative never spikes the user's quota; re-baseline to the new value.
    expect(r.deltas).toEqual([{ userId: 'u1', bytesIn: 0, bytesOut: 0 }]);
    expect(r.snapshots).toEqual([{ userId: 'u1', protocol: '', engine: '', cumIn: 40n, cumOut: 10n }]);
  });

  it('a failed tick loses nothing: next poll re-derives from the un-advanced baseline', () => {
    // Caller persists the snapshot in the same transaction as the increments,
    // so a failed commit leaves the baseline un-advanced. Against that same
    // baseline, a later poll's delta re-includes every byte since it - contrast
    // the destructive -reset model, where the drained bytes were gone.
    const baseline = new Map([['u1||', snap(100n, 0n)]]);
    const failedTick = computeUserDeltas([{ userId: 'u1', bytesIn: 250, bytesOut: 0 }], baseline);
    expect(failedTick.deltas[0]!.bytesIn).toBe(150); // would have billed 150, but commit failed
    const nextTick = computeUserDeltas([{ userId: 'u1', bytesIn: 400, bytesOut: 0 }], baseline);
    expect(nextTick.deltas[0]!.bytesIn).toBe(300); // 150 (lost tick) + 150 (this tick), nothing dropped
  });
});

/**
 * A-163, the scenario from the registry: a user on xray (40 GB) and sing-box
 * (9 GB) on one node; sing-box misses one poll; sing-box comes back. Summed
 * against one snapshot, the return billed 9 GB at once and the user went
 * limited. Per adapter it is the traffic that moved, about 0.02 GB.
 */
describe('computeUserDeltas per adapter (A-163)', () => {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const xray = (cum: number): StatsUserEntry => ({ userId: 'u', bytesIn: cum, bytesOut: 0, cumulative: true, protocol: 'xray', engine: 'xray' });
  const sb = (cum: number): StatsUserEntry => ({ userId: 'u', bytesIn: cum, bytesOut: 0, cumulative: true, protocol: 'xray', engine: 'singbox' });

  function run(polls: StatsUserEntry[][], start: Map<string, UserSnapshot>): number {
    const snaps = new Map(start);
    let billed = 0;
    for (const reported of polls) {
      const r = computeUserDeltas(reported, snaps);
      billed += r.deltas.reduce((a, d) => a + (d.bytesIn ?? 0) + (d.bytesOut ?? 0), 0);
      for (const s of r.snapshots) snaps.set(snapshotKey(s.userId, s), { cumIn: s.cumIn, cumOut: s.cumOut });
    }
    return billed;
  }

  it('xray 40 + sing-box 9; sing-box silent; sing-box back: about 0.02 GB, not 9.02', () => {
    const start = new Map<string, UserSnapshot>([
      [snapshotKey('u', { protocol: 'xray', engine: 'xray' }), { cumIn: BigInt(40 * GB), cumOut: 0n }],
      [snapshotKey('u', { protocol: 'xray', engine: 'singbox' }), { cumIn: BigInt(9 * GB), cumOut: 0n }],
    ]);
    const billed = run(
      [
        [xray(40 * GB + 10 * MB), sb(9 * GB)],
        // sing-box noData: the agent leaves its users out of users[]
        [xray(40 * GB + 20 * MB)],
        [xray(40 * GB + 20 * MB), sb(9 * GB)],
      ],
      start,
    );
    expect(billed).toBe(20 * MB);
  });

  it('the same polls summed into one snapshot (an agent without engine) still spike: what the per-adapter key fixes', () => {
    const legacy = (e: StatsUserEntry): StatsUserEntry => ({ ...e, engine: undefined });
    const start = new Map<string, UserSnapshot>([[snapshotKey('u', { protocol: '', engine: '' }), { cumIn: BigInt(49 * GB), cumOut: 0n }]]);
    const billed = run(
      [
        [legacy(xray(40 * GB + 10 * MB)), legacy(sb(9 * GB))],
        [legacy(xray(40 * GB + 20 * MB))],
        [legacy(xray(40 * GB + 20 * MB)), legacy(sb(9 * GB))],
      ],
      start,
    );
    expect(billed).toBe(10 * MB + 9 * GB);
  });
});

/**
 * A-152, the mixed node from the registry: xray (cumulative) beside AmneziaWG
 * (per-poll delta). Poll 1: xray baseline, AWG 50 MB; poll 2: xray +1 MB, AWG
 * 5 MB. One mixed counter read poll 2 as a drop and counted 0; per adapter it
 * is the 6 MB that crossed the wire.
 */
describe('computeNodeTotalsFromCores (A-152)', () => {
  const MB = 1024 ** 2;
  it('counts a delta core beside a cumulative one: 6 MB, not 0', () => {
    const p1 = computeNodeTotalsFromCores(
      [
        { protocol: 'xray', engine: 'xray', bytesIn: 100 * MB, bytesOut: 0, cumulative: true },
        { protocol: 'amneziawg', engine: 'amneziawg', bytesIn: 50 * MB, bytesOut: 0, cumulative: false },
      ],
      new Map(),
    );
    expect(p1.upload).toBe(BigInt(50 * MB)); // xray baselines, AWG counts
    const p2 = computeNodeTotalsFromCores(
      [
        { protocol: 'xray', engine: 'xray', bytesIn: 101 * MB, bytesOut: 0, cumulative: true },
        { protocol: 'amneziawg', engine: 'amneziawg', bytesIn: 5 * MB, bytesOut: 0, cumulative: false },
      ],
      p1.snapshots,
    );
    expect(p2.upload).toBe(BigInt(6 * MB));

    // And the old mixed path on the same numbers: the reason for the change.
    const old = computeNodeStatsWrites({
      users: [],
      multiplier: 1,
      totalBytesIn: 106 * MB,
      totalBytesOut: 0,
      nodeTotalIsCumulative: true,
      prevSnapshot: { in: BigInt(150 * MB), out: 0n },
    });
    expect(old.nodeUpload).toBe(0n);
  });

  it('an adapter with noData counts nothing and keeps its snapshot', () => {
    const prev = new Map([['xray|singbox', { in: BigInt(9 * MB), out: 0n }]]);
    const r = computeNodeTotalsFromCores(
      [{ protocol: 'xray', engine: 'singbox', bytesIn: 0, bytesOut: 0, cumulative: true, noData: true }],
      prev,
    );
    expect(r.upload).toBe(0n);
    expect(r.snapshots.has('xray|singbox')).toBe(false); // the caller keeps the old one
  });

  it('feeds computeNodeStatsWrites as the node total', () => {
    const w = computeNodeStatsWrites({
      users: [{ userId: 'u', bytesIn: 1 * MB, bytesOut: 0 }],
      multiplier: 1,
      nodeTotals: { upload: BigInt(6 * MB), download: 0n },
    });
    expect(w.nodeUpload).toBe(BigInt(6 * MB));
    expect(w.newSnapshot).toBeNull();
  });
});
