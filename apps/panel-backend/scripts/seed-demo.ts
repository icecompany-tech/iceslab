/**
 * Demo seeder: fills a LOCAL/demo DB with a clean, screenshot-ready dataset so
 * marketing shots never have to be taken against production with real Icepath
 * nodes painted over.
 *
 * Everything is clean by construction:
 *   - addresses are *.example.com (RFC 2606), doc-IPs would be 192.0.2.x /
 *     198.51.100.x (RFC 5737) if needed
 *   - all timestamps are UTC
 *   - 8 nodes (6 countries, 4 protocols) all ONLINE with varied telemetry
 *   - ~10 neutral users, 8 of them online "now" so the dashboard headline
 *     reads "Busy fleet" (onlineNow/total >= 0.7)
 *   - 48h of hourly traffic history + ~7 weeks of sparse history so the
 *     "Traffic last 24h" curve is pretty and week/month/year are non-zero
 *
 * Run:
 *   DEMO=1 pnpm --filter @iceslab/panel-backend seed:demo
 *
 * Safety: refuses to touch production. Requires DEMO=1, refuses when
 * NODE_ENV=production, and refuses a non-local / non-"demo" DATABASE_URL unless
 * DEMO_FORCE=1. It wipes the demo CONTENT tables (nodes, users, profiles,
 * groups, cascades, history) but never AdminUser / KeygenCa / ApiToken /
 * AppSetting, so the operator login and brand settings survive a re-seed.
 *
 * Idempotent: deterministic IDs (sha256-derived UUIDs from stable names) plus a
 * full content wipe at the start, so re-running gives a clean, repeatable set.
 *
 * Node telemetry (CPU/RAM/disk) is pushed straight into Redis at the same key
 * the dashboard reads (node:metrics:<id>). Because the node-healthcheck/metrics
 * /stats crons are gated off under DEMO=1 (see scheduler.queue.ts), nothing
 * flips the seeded nodes to "unreachable" and nothing TTLs the telemetry, so
 * the dashboard stays lively for as long as you need to shoot.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../src/prisma.js';
import { redis } from '../src/lib/redis.js';
import { nodeMetricsKey } from '../src/modules/nodes/nodes.cron.js';

// ───── Safety fence ──────────────────────────────────────────────────────────

function refuse(msg: string): never {
  console.error(`\n[seed:demo] REFUSING TO RUN.\n  ${msg}\n`);
  process.exit(1);
}

function assertSafe(): string {
  const url = process.env['DATABASE_URL'] ?? '';
  if (process.env['NODE_ENV'] === 'production') {
    refuse('NODE_ENV=production. This script deletes data and must never run against prod.');
  }
  if (process.env['DEMO'] !== '1') {
    refuse('DEMO=1 is required. Set it explicitly to confirm this is a demo DB.');
  }
  if (!url) {
    refuse('DATABASE_URL is empty. Point it at a local/demo database first.');
  }

  let host = '';
  let dbname = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    dbname = u.pathname.replace(/^\//, '').toLowerCase();
  } catch {
    // Unparseable URL: treat as non-local and force the explicit override.
    host = '';
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const looksDemo = host.includes('demo') || dbname.includes('demo');
  if (!isLocal && !looksDemo && process.env['DEMO_FORCE'] !== '1') {
    refuse(
      `DATABASE_URL host "${host || '(unparseable)'}" is neither local nor a "demo" database.\n` +
        '  If you are SURE this is a throwaway demo DB, re-run with DEMO_FORCE=1.',
    );
  }

  console.log(
    `[seed:demo] target DB host="${host || '(unparseable)'}" db="${dbname || '?'}" ` +
      `(local=${isLocal} demo=${looksDemo})`,
  );
  return url;
}

// ───── Deterministic helpers (so re-runs produce identical IDs) ──────────────

const GiB = 1024 ** 3;

function detUuid(seed: string): string {
  const b = createHash('sha256').update(seed).digest().subarray(0, 16);
  const bb = Buffer.from(b);
  bb[6] = (bb[6]! & 0x0f) | 0x40; // version 4
  bb[8] = (bb[8]! & 0x3f) | 0x80; // variant 10
  const h = bb.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Deterministic printable token (base64url-ish) of a given length. */
function detToken(seed: string, len: number): string {
  let out = '';
  let i = 0;
  while (out.length < len) {
    out += createHash('sha256').update(`${seed}:${i++}`).digest('base64url');
  }
  return out.slice(0, len);
}

/** Deterministic base64 32-byte-ish key (for display-only demo creds). */
function detKey(seed: string): string {
  return createHash('sha256').update(seed).digest('base64');
}

function gibToBig(n: number): bigint {
  return BigInt(Math.round(n * GiB));
}

function nodeId(key: string): string {
  return detUuid(`node:${key}`);
}
function userId(handle: string): string {
  return detUuid(`user:${handle}`);
}
function profileId(key: string): string {
  return detUuid(`profile:${key}`);
}
function groupId(name: string): string {
  return detUuid(`group:${name}`);
}
function regionId(code: string): string {
  return detUuid(`region:${code}`);
}
function bindingId(profileKey: string, nodeKey: string): string {
  return detUuid(`binding:${profileKey}:${nodeKey}`);
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

// ───── Dataset definitions ───────────────────────────────────────────────────

interface RegionDef {
  code: string;
  name: string;
}
const REGIONS: RegionDef[] = [
  { code: 'EU', name: 'Europe' },
  { code: 'US', name: 'North America' },
  { code: 'AS', name: 'Asia' },
  { code: 'RU', name: 'RU TSPU-zone' },
];

interface NodeDef {
  key: string;
  host: string;
  cc: string;
  proto: string;
  region: string;
  selfSteal?: boolean;
  /** Baseline traffic volume for history generation, GiB/hour at daily peak. */
  baseGiBHr: number;
}
const NODES: NodeDef[] = [
  { key: 'xray-de-01', host: 'de-01.example.com', cc: 'DE', proto: 'xray', region: 'EU', selfSteal: true, baseGiBHr: 22 },
  { key: 'xray-de-02', host: 'de-02.example.com', cc: 'DE', proto: 'xray', region: 'EU', selfSteal: true, baseGiBHr: 14 },
  { key: 'hy2-nl-01', host: 'nl-01.example.com', cc: 'NL', proto: 'hysteria', region: 'EU', baseGiBHr: 18 },
  { key: 'awg-se-01', host: 'se-01.example.com', cc: 'SE', proto: 'amneziawg', region: 'EU', baseGiBHr: 9 },
  { key: 'ss-fi-01', host: 'fi-01.example.com', cc: 'FI', proto: 'shadowsocks', region: 'EU', baseGiBHr: 6 },
  { key: 'xray-us-01', host: 'us-01.example.com', cc: 'US', proto: 'xray', region: 'US', selfSteal: true, baseGiBHr: 20 },
  { key: 'hy2-sg-01', host: 'sg-01.example.com', cc: 'SG', proto: 'hysteria', region: 'AS', baseGiBHr: 12 },
  { key: 'awg-ru-01', host: 'ru-01.example.com', cc: 'RU', proto: 'amneziawg', region: 'RU', baseGiBHr: 8 },
];

interface ProfileDef {
  key: string;
  name: string;
  proto: string;
  nodes: string[];
  port: number;
  config: Record<string, unknown>;
}
const PROFILES: ProfileDef[] = [
  {
    key: 'vless-reality',
    name: 'vless-reality',
    proto: 'xray',
    nodes: ['xray-de-01', 'xray-de-02', 'xray-us-01'],
    port: 443,
    config: {
      network: 'tcp',
      security: 'reality',
      sni: 'www.microsoft.com',
      flow: 'xtls-rprx-vision',
      fingerprint: 'chrome',
      publicKey: detToken('reality-pub', 43),
      shortId: detToken('reality-sid', 8).toLowerCase().replace(/[^0-9a-f]/g, '0'),
    },
  },
  {
    key: 'hy2',
    name: 'hy2',
    proto: 'hysteria',
    nodes: ['hy2-nl-01', 'hy2-sg-01'],
    port: 443,
    config: {
      obfs: 'salamander',
      obfsPassword: detToken('hy2-obfs', 24),
      up: '100 mbps',
      down: '200 mbps',
      masqueradeUrl: 'https://www.bing.com',
    },
  },
  {
    key: 'awg',
    name: 'awg',
    proto: 'amneziawg',
    nodes: ['awg-se-01', 'awg-ru-01'],
    port: 51820,
    // S1/S2 forced to 0 (see reference_amneziawg_s3s4_bug); subnet avoids the
    // Aeza host-gateway collision (10.66.66.0/24, see project_aeza_subnet_gotcha).
    config: {
      jc: 4,
      jmin: 40,
      jmax: 70,
      s1: 0,
      s2: 0,
      h1: 1,
      h2: 2,
      h3: 3,
      h4: 4,
      subnet: '10.66.66.0/24',
    },
  },
  {
    key: 'ss2022',
    name: 'ss2022',
    proto: 'shadowsocks',
    nodes: ['ss-fi-01'],
    port: 8388,
    config: {
      method: '2022-blake3-aes-256-gcm',
    },
  },
];

interface GroupDef {
  name: string;
  description: string;
  profiles: string[];
}
const GROUPS: GroupDef[] = [
  { name: 'default', description: 'Standard squad', profiles: ['vless-reality', 'hy2', 'ss2022'] },
  { name: 'premium', description: 'Premium squad (adds AmneziaWG)', profiles: ['vless-reality', 'hy2', 'ss2022', 'awg'] },
];

type UserStatus = 'active' | 'limited' | 'expired' | 'disabled';
interface UserDef {
  h: string;
  status: UserStatus;
  squads: string[];
  home: string;
  /** Seconds-ago for onlineAt. <=180 counts as "online now". */
  onlineSec: number;
  gibToday: number;
  usedGiB: number;
  limitGiB: number | null;
  expDays: number;
}
// 7 active + 1 limited + 1 expired + 1 disabled. onlineSec <= 180 for 8 of them
// (the 7 active + omar) => onlineNow=8, total=10 => 80% => "Busy fleet".
const USERS: UserDef[] = [
  { h: 'alex', status: 'active', squads: ['default', 'premium'], home: 'xray-de-01', onlineSec: 25, gibToday: 14, usedGiB: 118, limitGiB: 200, expDays: 35 },
  { h: 'mia', status: 'active', squads: ['premium'], home: 'xray-us-01', onlineSec: 40, gibToday: 11, usedGiB: 96, limitGiB: 200, expDays: 28 },
  { h: 'kenji', status: 'active', squads: ['default', 'premium'], home: 'hy2-sg-01', onlineSec: 65, gibToday: 9, usedGiB: 140, limitGiB: null, expDays: 40 },
  { h: 'sofia', status: 'active', squads: ['premium'], home: 'xray-de-02', onlineSec: 80, gibToday: 7, usedGiB: 70, limitGiB: 150, expDays: 22 },
  { h: 'liam', status: 'active', squads: ['default'], home: 'hy2-nl-01', onlineSec: 110, gibToday: 4, usedGiB: 41, limitGiB: 100, expDays: 18 },
  { h: 'nadia', status: 'active', squads: ['default'], home: 'ss-fi-01', onlineSec: 140, gibToday: 3, usedGiB: 33, limitGiB: 100, expDays: 30 },
  { h: 'diego', status: 'active', squads: ['default'], home: 'awg-se-01', onlineSec: 95, gibToday: 5, usedGiB: 88, limitGiB: null, expDays: 12 },
  { h: 'omar', status: 'limited', squads: ['default'], home: 'hy2-nl-01', onlineSec: 50, gibToday: 2, usedGiB: 52, limitGiB: 50, expDays: 25 },
  { h: 'yuki', status: 'expired', squads: ['default'], home: 'xray-de-01', onlineSec: 5 * 3600, gibToday: 0, usedGiB: 64, limitGiB: 100, expDays: -3 },
  { h: 'elena', status: 'disabled', squads: ['premium'], home: 'xray-us-01', onlineSec: 30 * 3600, gibToday: 0, usedGiB: 12, limitGiB: 100, expDays: 60 },
];

const PROTOCOLS_BY_SQUAD: Record<string, string[]> = {
  default: ['xray', 'hysteria', 'shadowsocks'],
  premium: ['xray', 'hysteria', 'shadowsocks', 'amneziawg'],
};

// ───── Reset (FK-safe order; demo CONTENT only) ──────────────────────────────

async function wipe(): Promise<void> {
  console.log('[seed:demo] wiping demo content tables...');
  // Children -> parents. AdminUser / KeygenCa / ApiToken / AppSetting are NOT
  // touched on purpose (operator login + brand survive a re-seed).
  await prisma.cascadeHop.deleteMany({});
  await prisma.cascade.deleteMany({});
  await prisma.host.deleteMany({});
  await prisma.profileNodeBinding.deleteMany({});
  await prisma.amneziawgPeer.deleteMany({});
  await prisma.nodeUserUsageHistory.deleteMany({});
  await prisma.nodeUsageHistory.deleteMany({});
  await prisma.nodeUserTrafficSnapshot.deleteMany({});
  await prisma.hwidUserDevice.deleteMany({});
  await prisma.subscriptionRequestHistory.deleteMany({});
  await prisma.subscriptionEvent.deleteMany({});
  await prisma.userTraffic.deleteMany({});
  await prisma.groupMember.deleteMany({});
  await prisma.groupProfile.deleteMany({});
  await prisma.groupInbound.deleteMany({}); // legacy
  await prisma.inbound.deleteMany({}); // legacy
  await prisma.profile.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.node.deleteMany({});
  await prisma.region.deleteMany({});
  await prisma.group.deleteMany({});
}

// ───── Time helpers (all UTC) ────────────────────────────────────────────────

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function currentUtcHour(): Date {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d;
}
/** Daily volume shape, peaks ~20:00 UTC, trough ~06:00. Range ~0.35..1.0. */
function diurnal(hourOfDay: number): number {
  return 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(((hourOfDay - 6) / 24) * 2 * Math.PI));
}

// ───── Seed ──────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  // Regions
  for (const r of REGIONS) {
    await prisma.region.create({ data: { id: regionId(r.code), name: r.name, code: r.code } });
  }

  // Nodes (all online, fresh status change, required heartbeatSecret)
  const statusSince = new Date(Date.now() - 3 * 3600 * 1000); // came up 3h ago
  for (const n of NODES) {
    await prisma.node.create({
      data: {
        id: nodeId(n.key),
        name: n.key,
        address: `${n.host}:1337`,
        protocol: n.proto,
        countryCode: n.cc,
        status: 'online',
        lastStatusChange: statusSince,
        lastStatusMessage: null,
        regionId: regionId(n.region),
        maxUsers: 1000,
        domain: n.selfSteal ? n.host : null,
        heartbeatSecret: randomBytes(32),
      },
    });
  }

  // Profiles + bindings + one default host per binding
  for (const p of PROFILES) {
    await prisma.profile.create({
      data: {
        id: profileId(p.key),
        name: p.name,
        protocol: p.proto,
        description: `Demo ${p.name} profile`,
        config: p.config,
        enabled: true,
      },
    });
    for (const nk of p.nodes) {
      const bId = bindingId(p.key, nk);
      const host = NODES.find((x) => x.key === nk)!.host;
      await prisma.profileNodeBinding.create({
        data: {
          id: bId,
          profileId: profileId(p.key),
          nodeId: nodeId(nk),
          port: p.port,
          publicHost: host,
          publicPort: p.port,
          enabled: true,
        },
      });
      await prisma.host.create({
        data: {
          id: detUuid(`host:${p.key}:${nk}`),
          bindingId: bId,
          remark: 'Direct',
          priority: 0,
          enabled: true,
        },
      });
    }
  }

  // Groups + group<->profile ACL
  for (const g of GROUPS) {
    await prisma.group.create({
      data: { id: groupId(g.name), name: g.name, description: g.description },
    });
    for (const pk of g.profiles) {
      await prisma.groupProfile.create({
        data: { groupId: groupId(g.name), profileId: profileId(pk) },
      });
    }
  }

  // Users + traffic + squad membership
  for (const u of USERS) {
    const protos = Array.from(new Set(u.squads.flatMap((s) => PROTOCOLS_BY_SQUAD[s] ?? [])));
    await prisma.user.create({
      data: {
        id: userId(u.h),
        shortId: detToken(`short:${u.h}`, 12),
        username: u.h,
        status: u.status,
        expireAt: new Date(Date.now() + u.expDays * 24 * 3600 * 1000),
        trafficLimitBytes: u.limitGiB === null ? null : gibToBig(u.limitGiB),
        trafficLimitStrategy: 'no_reset',
        subscriptionToken: detToken(`sub:${u.h}`, 48),
        hysteriaPassword: detToken(`hy:${u.h}`, 32),
        amneziawgPrivateKey: detKey(`awgpriv:${u.h}`),
        amneziawgPublicKey: detKey(`awgpub:${u.h}`),
        naivePassword: detToken(`naive:${u.h}`, 32),
        xrayUuid: detUuid(`xray:${u.h}`),
        enabledProtocols: protos,
        description: null,
        tag: u.squads.includes('premium') ? 'premium' : 'standard',
      },
    });
    await prisma.userTraffic.create({
      data: {
        userId: userId(u.h),
        usedTrafficBytes: gibToBig(u.usedGiB),
        lifetimeTrafficBytes: gibToBig(u.usedGiB * 2.4 + 20),
        onlineAt: new Date(Date.now() - u.onlineSec * 1000),
        firstConnectedAt: new Date(Date.now() - rand(40, 120) * 24 * 3600 * 1000),
        lastConnectedNodeId: nodeId(u.home),
      },
    });
    for (const s of u.squads) {
      await prisma.groupMember.create({ data: { groupId: groupId(s), userId: userId(u.h) } });
    }
  }

  // ─── Traffic history: NodeUsageHistory (per node, per hour) ───
  const nodeUsage: { nodeId: string; hour: Date; downloadBytes: bigint; uploadBytes: bigint }[] = [];
  const baseHour = currentUtcHour();
  for (const n of NODES) {
    // Dense: last 48 hours.
    for (let i = 0; i < 48; i++) {
      const hour = new Date(baseHour.getTime() - i * 3600 * 1000);
      const factor = diurnal(hour.getUTCHours()) * rand(0.85, 1.15);
      const totalGiB = n.baseGiBHr * factor;
      nodeUsage.push({
        nodeId: nodeId(n.key),
        hour,
        downloadBytes: gibToBig(totalGiB * 0.8),
        uploadBytes: gibToBig(totalGiB * 0.2),
      });
    }
    // Sparse: 3 samples/day for days 3..50 ago -> week/month/year + "vs prev".
    const today = startOfTodayUtc();
    for (let d = 3; d <= 50; d++) {
      for (const H of [8, 14, 21]) {
        const hour = new Date(today.getTime() - d * 24 * 3600 * 1000 + H * 3600 * 1000);
        const factor = diurnal(H) * rand(0.7, 1.1);
        const totalGiB = n.baseGiBHr * factor;
        nodeUsage.push({
          nodeId: nodeId(n.key),
          hour,
          downloadBytes: gibToBig(totalGiB * 0.8),
          uploadBytes: gibToBig(totalGiB * 0.2),
        });
      }
    }
  }
  await prisma.nodeUsageHistory.createMany({ data: nodeUsage });

  // ─── Per-user usage: NodeUserUsageHistory (per node, per user, per DATE) ───
  // Today rows drive the Top-5; ranking is by bytesIn, so keep bytesIn the
  // larger share so it tracks total.
  const userUsage: { nodeId: string; userId: string; date: Date; bytesIn: bigint; bytesOut: bigint }[] = [];
  const today = startOfTodayUtc();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (const u of USERS) {
    if (u.gibToday > 0) {
      userUsage.push({
        nodeId: nodeId(u.home),
        userId: userId(u.h),
        date: todayDate,
        bytesIn: gibToBig(u.gibToday * 0.55),
        bytesOut: gibToBig(u.gibToday * 0.45),
      });
    }
    // Past 14 days for the online users so the per-user history looks lived-in.
    if (u.onlineSec <= 180 && u.gibToday > 0) {
      for (let d = 1; d <= 14; d++) {
        const g = u.gibToday * rand(0.5, 1.2);
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - d * 24 * 3600 * 1000);
        userUsage.push({
          nodeId: nodeId(u.home),
          userId: userId(u.h),
          date,
          bytesIn: gibToBig(g * 0.55),
          bytesOut: gibToBig(g * 0.45),
        });
      }
    }
  }
  await prisma.nodeUserUsageHistory.createMany({ data: userUsage });

  // ─── Cascade: ru-exit-bypass ───
  // Only xray->xray cascades are realised today (native xray entry -> vless
  // REALITY inter-hop link). So both hops are xray nodes: REALITY entry ->
  // EU exit. Other protocol cells (awg/hysteria entry) are not wired yet.
  const cId = detUuid('cascade:ru-exit-bypass');
  await prisma.cascade.create({ data: { id: cId, name: 'ru-exit-bypass', enabled: true } });
  await prisma.cascadeHop.create({
    data: {
      id: detUuid('hop:ru-exit-bypass:0'),
      cascadeId: cId,
      nodeId: nodeId('xray-de-01'),
      position: 0,
      entryProtocol: 'xray', // client-facing REALITY entry
      linkProtocol: 'vless', // REALITY inter-hop to the exit
    },
  });
  await prisma.cascadeHop.create({
    data: {
      id: detUuid('hop:ru-exit-bypass:1'),
      cascadeId: cId,
      nodeId: nodeId('xray-de-02'),
      position: 1, // exit: egress direct, no linkProtocol
    },
  });

  // ─── Recent activity feed (dashboard "recent events") ───
  const evt: { userId: string; eventType: string; createdAt: Date }[] = [
    { userId: userId('alex'), eventType: 'user_created', createdAt: new Date(Date.now() - 22 * 3600 * 1000) },
    { userId: userId('mia'), eventType: 'traffic_limit_changed', createdAt: new Date(Date.now() - 18 * 3600 * 1000) },
    { userId: userId('yuki'), eventType: 'expired', createdAt: new Date(Date.now() - 14 * 3600 * 1000) },
    { userId: userId('omar'), eventType: 'limited', createdAt: new Date(Date.now() - 9 * 3600 * 1000) },
    { userId: userId('sofia'), eventType: 'expire_extended', createdAt: new Date(Date.now() - 6 * 3600 * 1000) },
    { userId: userId('elena'), eventType: 'disabled', createdAt: new Date(Date.now() - 4 * 3600 * 1000) },
    { userId: userId('kenji'), eventType: 'traffic_reset', createdAt: new Date(Date.now() - 3 * 3600 * 1000) },
    { userId: userId('diego'), eventType: 'user_created', createdAt: new Date(Date.now() - 90 * 60 * 1000) },
  ];
  await prisma.subscriptionEvent.createMany({ data: evt });
}

// ───── Redis: per-node telemetry + cache bust ────────────────────────────────

interface Snap {
  cpu: { usagePercent: number; loadAvg1: number; loadAvg5: number; loadAvg15: number; cores: number };
  memory: { totalBytes: number; availableBytes: number; usedBytes: number; usedPercent: number };
  disk: { path: string; totalBytes: number; usedBytes: number; usedPercent: number };
  uptimeSeconds: number;
  collectedAt: string;
}

function buildSnapshot(idx: number): Snap {
  const sizes = [
    { ram: 2 * GiB, disk: 20 * GiB, cores: 2 },
    { ram: 4 * GiB, disk: 40 * GiB, cores: 2 },
    { ram: 8 * GiB, disk: 80 * GiB, cores: 4 },
    { ram: 16 * GiB, disk: 160 * GiB, cores: 8 },
  ];
  // mixed buckets so the node table shows a spread of green/yellow/red bars.
  const buckets = [
    { c: 18, m: 35, d: 25 },
    { c: 55, m: 70, d: 55 },
    { c: 88, m: 92, d: 82 },
    { c: 35, m: 50, d: 40 },
  ];
  const s = sizes[idx % sizes.length]!;
  const b = buckets[idx % buckets.length]!;
  const cpuPct = Math.min(99, Math.max(1, b.c + rand(-5, 5)));
  const memPct = Math.min(99, Math.max(1, b.m + rand(-3, 3)));
  const diskPct = Math.min(99, Math.max(1, b.d + rand(-2, 2)));
  const memUsed = Math.floor((memPct / 100) * s.ram);
  const diskUsed = Math.floor((diskPct / 100) * s.disk);
  const la1 = Number(((cpuPct / 100) * s.cores + rand(-0.1, 0.1)).toFixed(2));
  return {
    cpu: {
      usagePercent: Number(cpuPct.toFixed(1)),
      loadAvg1: Math.max(0, la1),
      loadAvg5: Math.max(0, Number((la1 * 0.85).toFixed(2))),
      loadAvg15: Math.max(0, Number((la1 * 0.7).toFixed(2))),
      cores: s.cores,
    },
    memory: {
      totalBytes: s.ram,
      availableBytes: s.ram - memUsed,
      usedBytes: memUsed,
      usedPercent: Number(memPct.toFixed(1)),
    },
    disk: { path: '/', totalBytes: s.disk, usedBytes: diskUsed, usedPercent: Number(diskPct.toFixed(1)) },
    uptimeSeconds: 60 * 60 * 24 * 3 + idx * 1234,
    collectedAt: new Date().toISOString(),
  };
}

async function seedRedis(): Promise<void> {
  // Drop any stale node:metrics:* (e.g. from a prior seed with other ids).
  const stale = await redis.keys('node:metrics:*');
  if (stale.length > 0) await redis.del(...stale);

  // Long TTL: the node crons are gated off under DEMO=1, so nothing refreshes
  // these; 24h is plenty for a screenshot session.
  const TTL = 24 * 3600;
  let i = 0;
  for (const n of NODES) {
    await redis.set(nodeMetricsKey(nodeId(n.key)), JSON.stringify(buildSnapshot(i++)), 'EX', TTL);
  }
  // Bust the assembled dashboard cache so the next poll recomputes fresh.
  await redis.del('dashboard:overview:v1');
}

// ───── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertSafe();
  await wipe();
  await seed();
  await seedRedis();

  const onlineNow = USERS.filter((u) => u.onlineSec <= 180).length;
  const headline =
    onlineNow >= USERS.length * 0.7 ? 'Busy fleet' : onlineNow <= USERS.length * 0.3 ? 'Quiet day' : 'Steady';
  console.log('\n[seed:demo] done.');
  console.log(`  nodes:    ${NODES.length} (all online)`);
  console.log(`  profiles: ${PROFILES.length}   squads: ${GROUPS.length}   cascades: 1`);
  console.log(`  users:    ${USERS.length}  (online now: ${onlineNow})  -> headline: "${headline}"`);
  console.log('  Run the panel with DEMO=1 so the node crons stay gated and nodes stay online.\n');
}

main()
  .catch((err) => {
    console.error('[seed:demo] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  });
