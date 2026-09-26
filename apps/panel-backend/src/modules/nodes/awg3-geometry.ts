import { randomBytes, randomInt } from 'node:crypto';
import type { AwgGeometry3 } from '@iceslab/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';

/**
 * A node's AmneziaWG 3.1 geometry (t07-6): minted here ONCE per node and
 * stored (nodes.awg3_geometry), the way leg credentials are, so a classifier
 * that learned one node has not learned the fleet.
 *
 * The draw follows awg3-geometry.sh (MIT, wyrtensi/amnezia-shared-panel
 * 2066a80): each range and each refusal below names the line it came from
 * there. The bounds are the agent's table (apps/node/internal/core/amneziawg/
 * geometry3.go), rule for rule and under the same ids, checked BEFORE a
 * geometry is stored: a value the agent would refuse turns into a failed apply
 * on the node, and the operator learns it from a red push instead of here.
 * testdata/geometry3-minted.json (beside geometry3.go) is minted by this file
 * and read by the agent's test, so the two tables cannot drift apart unseen.
 */

/** The tunnel MTU every geometry is minted for: AmneziaVPN's desktop default
 *  (the app overwrites a key's mtu with 1376 on desktop, 1280 on mobile), so
 *  the S4 budget holds for both. */
export const AWG3_MTU = 1376;

export interface GeometryRandom {
  /** Uniform integer in [lo, hi]. */
  int(lo: number, hi: number): number;
  bytes(n: number): Buffer;
}

export const cryptoRandom: GeometryRandom = {
  int: (lo, hi) => randomInt(lo, hi + 1),
  bytes: (n) => randomBytes(n),
};

const span = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}-${hi}`);

/** A `lo-hi` range: lo from [loMin, loMax], width from [wMin, wMax] (rand_span). */
function randSpan(r: GeometryRandom, loMin: number, loMax: number, wMin: number, wMax: number): string {
  const lo = r.int(loMin, loMax);
  return span(lo, lo + r.int(wMin, wMax));
}

const hex = (b: Buffer) => b.toString('hex');

/**
 * One draw, then the table. The draw is built to pass it; the table is what
 * refuses, and a draw it refuses is drawn again (the script's own assert-and-
 * refuse, turned into a retry because here nobody is watching a terminal).
 */
export function mintAwg3Geometry(r: GeometryRandom = cryptoRandom, mtu = AWG3_MTU): AwgGeometry3 {
  for (let attempt = 0; attempt < 100; attempt++) {
    const g = drawOnce(r, mtu);
    if (awg3GeometryViolations(g).length === 0) return g;
  }
  throw new Error(`could not mint a 3.1 geometry for MTU ${mtu}`);
}

function drawOnce(r: GeometryRandom, mtu: number): AwgGeometry3 {
  // Headers: distinct, in [16, 2^31) (awg3-geometry.sh:53-80).
  const hs: number[] = [];
  while (hs.length < 4) {
    const h = r.int(16, 2147483646);
    if (!hs.includes(h)) hs.push(h);
  }
  // Junk: Jmin strictly below Jmax, or the daemon allocates ~4 GB (:81-90).
  const jc = r.int(3, 10);
  const jmin = r.int(40, 100);
  const jmax = jmin + r.int(30, 200);
  // S: floor 12 (header nonce), S4 out of the MTU budget, four distinct
  // packet-class sizes (:92-122).
  const s4Max = Math.min(64, 1500 - 32 - mtu - 28);
  const s1 = r.int(12, 150);
  const s2 = r.int(12, 150);
  const s3 = r.int(12, 64);
  const s4 = r.int(12, Math.max(12, s4Max));
  // Decoys: a DNS query, a STUN request with a true length, noise; how many
  // and in which order drawn per node (:124-180).
  const label = r.int(3, 12);
  const dns =
    '<r 2><b 0x0100><b 0x00010000><b 0x00000000>' +
    `<b 0x${label.toString(16).padStart(2, '0')}><rc ${label}>` +
    '<b 0x03636f6d00><b 0x0001><b 0x0001>';
  const stun = '<b 0x0001><b 0x000c><b 0x2112a442><r 12><b 0x8022><b 0x0008><rc 8>';
  const noise = `<r ${r.int(48, 220)}>`;
  const orders = [
    [dns, stun, noise],
    [dns, noise, stun],
    [stun, dns, noise],
    [stun, noise, dns],
    [noise, dns, stun],
    [noise, stun, dns],
  ];
  const decoys = orders[r.int(0, 5)]!.slice(0, r.int(1, 3));
  return {
    mtu,
    jc,
    jmin,
    jmax,
    s1,
    s2,
    s3,
    s4,
    h1: `${hs[0]}`,
    h2: `${hs[1]}`,
    h3: `${hs[2]}`,
    h4: `${hs[3]}`,
    i1: decoys[0] ?? '',
    i2: decoys[1] ?? '',
    i3: decoys[2] ?? '',
    i4: '',
    i5: '',
    // The client's own installer mints it as a Curve25519 private key; any 32
    // bytes are one, base64 like every key in the file (:installer, awgInstaller.cpp:56).
    headerProtectionKey: r.bytes(32).toString('base64'),
    contentPaddingAddition: span(1, r.int(16, 64)),
    rekeyAfterTime: randSpan(r, 95, 115, 25, 55),
    rekeyTimeout: randSpan(r, 4, 6, 2, 4),
    rejectAfterTime: randSpan(r, 200, 230, 30, 60),
    keepaliveTimeout: randSpan(r, 8, 12, 5, 10),
    maxHandshakeAttempts: randSpan(r, 12, 16, 4, 8),
    randomTrailers: true,
  };
}

// ───── The table, the agent's ids ─────

interface Span {
  lo: number;
  hi: number;
}

function parseSpan(s: string): Span | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const lo = Number(m[1]);
  return { lo, hi: m[2] === undefined ? lo : Number(m[2]) };
}

const WG_KEY = /^[A-Za-z0-9+/]{43}=$/;
const I_CHARS = /^[0-9a-fA-FxX<> rt]*$/;
const NONCE_FLOOR = 12;
const U16 = 65535;

/**
 * The ids of every rule the geometry breaks, in the agent's table order.
 * Empty is a geometry the agent renders.
 */
export function awg3GeometryViolations(g: AwgGeometry3): string[] {
  const out: string[] = [];
  const spans = {
    h: [g.h1, g.h2, g.h3, g.h4].map(parseSpan),
    cpa: parseSpan(g.contentPaddingAddition),
    rekeyAfter: parseSpan(g.rekeyAfterTime),
    rekeyTimeout: parseSpan(g.rekeyTimeout),
    rejectAfter: parseSpan(g.rejectAfterTime),
    keepalive: parseSpan(g.keepaliveTimeout),
    maxHs: parseSpan(g.maxHandshakeAttempts),
  };
  const timing = [spans.rekeyAfter, spans.rekeyTimeout, spans.rejectAfter, spans.keepalive, spans.maxHs];
  const u16Spans = [...timing, spans.cpa];
  // A string the tools cannot read is refused as a whole: the agent refuses it
  // at parse, before its table.
  if ([...spans.h, ...u16Spans].some((s) => s === null)) return ['unparsable'];
  const S = (s: Span | null) => s!;
  const ss = [g.s1, g.s2, g.s3, g.s4];

  if (!WG_KEY.test(g.headerProtectionKey) || Buffer.from(g.headerProtectionKey, 'base64').length !== 32)
    out.push('hpk-required');
  if (ss.some((s) => s < NONCE_FLOOR)) out.push('s-nonce-floor');
  if ([g.jc, g.jmin, g.jmax, ...ss].some((v) => !Number.isInteger(v) || v < 0 || v > U16)) out.push('scalar-uint16');
  if (u16Spans.some((s) => S(s).lo > U16 || S(s).hi > U16)) out.push('range-uint16');
  if ([...u16Spans, ...spans.h].some((s) => S(s).lo < 0 || S(s).hi < S(s).lo)) out.push('range-order');
  if (g.mtu < 1280 || g.mtu > 1420) out.push('mtu-range');
  if (g.s4 + 32 + g.mtu + 28 > 1500) out.push('s4-mtu-budget');
  const sizes = [g.s1 + 148, g.s2 + 92, g.s3 + 64, g.s4 + 32];
  if (new Set(sizes).size !== sizes.length) out.push('class-sizes-distinct');
  if (g.jmin >= g.jmax) out.push('junk-order');
  if (g.jmax > 1000) out.push('junk-ceiling');
  if (spans.h.some((s) => S(s).lo < 16 || S(s).hi >= 2 ** 31)) out.push('header-bounds');
  const hs = spans.h.map(S);
  if (hs.some((a, i) => hs.some((b, j) => j > i && a.lo <= b.hi && b.lo <= a.hi))) out.push('headers-disjoint');
  if (S(spans.cpa).lo < 1) out.push('content-padding-set');
  if (timing.some((s) => S(s).lo < 1)) out.push('timings-set');
  if (S(spans.rejectAfter).lo < 180) out.push('reject-floor');
  if (S(spans.rekeyAfter).hi >= S(spans.rejectAfter).lo) out.push('rekey-before-reject');
  if (S(spans.rejectAfter).lo <= S(spans.keepalive).hi + S(spans.rekeyTimeout).hi) out.push('reject-after-keepalive');
  if (g.randomTrailers !== true) out.push('random-trailers-on');
  if (g.i1.trim() === '') out.push('i1-present');
  if ([g.i1, g.i2, g.i3, g.i4, g.i5].some((i) => !I_CHARS.test(i))) out.push('i-charset');
  return out;
}

/**
 * The stored geometry, or null when there is none.
 *
 * ⚠ A stored one that no longer passes the table is RETURNED, not replaced:
 * every client key handed out for the node carries it, and a quiet re-mint
 * would disconnect all of them at once. The agent refuses it loudly on the
 * push instead, and a rotation is an operator's act.
 */
export function readAwg3Geometry(raw: unknown): AwgGeometry3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Partial<AwgGeometry3>;
  return typeof g.headerProtectionKey === 'string' ? (g as AwgGeometry3) : null;
}

/**
 * The node's geometry: the stored one, else a new one, stored. Called from
 * the push, where a 3.1 inbound is about to be rendered, and from the
 * subscription, like the hysteria pair. null for a node that does not exist.
 */
export async function ensureAwg3Geometry(nodeId: string): Promise<AwgGeometry3 | null> {
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { awg3Geometry: true } });
  if (!node) return null;
  const stored = readAwg3Geometry(node.awg3Geometry);
  if (stored) return stored;
  // Written only where none is stored, then read back: two pushes minting at
  // once must end on ONE geometry, or the node runs one and a key carries the
  // other.
  await prisma.node.updateMany({
    where: { id: nodeId, awg3Geometry: { equals: Prisma.DbNull } },
    data: { awg3Geometry: mintAwg3Geometry() as unknown as Prisma.InputJsonValue },
  });
  const after = await prisma.node.findUnique({ where: { id: nodeId }, select: { awg3Geometry: true } });
  return readAwg3Geometry(after?.awg3Geometry);
}
