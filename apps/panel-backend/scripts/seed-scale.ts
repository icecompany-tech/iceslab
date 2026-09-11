/**
 * Scale seeder: grows an already-seeded demo database up to a target user and
 * node count so the panel can be judged at the size a real operator runs, not
 * at the ten-row size a screenshot needs.
 *
 * Runs ON TOP of seed-demo (it never wipes): the demo's profiles, squads,
 * cascade and history stay, and this only appends nodes, users, traffic rows
 * and bindings until the totals are reached. Re-running is safe, it tops up to
 * the target instead of adding another full batch.
 *
 * Run (against a LOCAL/demo db, never prod):
 *   DEMO=1 SCALE_USERS=10000 SCALE_NODES=30 \
 *     pnpm --filter @iceslab/panel-backend exec tsx --env-file=../../.env scripts/seed-scale.ts
 *
 * Flags (env):
 *   DEMO=1            required, confirms this is a throwaway db
 *   SCALE_USERS=10000 target TOTAL user count (default 10000)
 *   SCALE_NODES=30    target TOTAL node count (default 30)
 *   SCALE_FORCE=1     bypass the local-db fence
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../src/generated/prisma/client.js';
import { prisma } from '../src/prisma.js';
import { redis } from '../src/lib/infra/redis.js';
import { nodeMetricsKey } from '../src/modules/nodes/nodes.cron.js';

const GiB = 1024 ** 3;
const TARGET_USERS = Number(process.env['SCALE_USERS'] ?? 10000);
const TARGET_NODES = Number(process.env['SCALE_NODES'] ?? 30);
const BATCH = 1000;

// ───── Safety fence ──────────────────────────────────────────────────────────

function refuse(msg: string): never {
  console.error(`\n[seed:scale] REFUSING TO RUN.\n  ${msg}\n`);
  process.exit(1);
}

function assertSafe(): void {
  if (process.env['NODE_ENV'] === 'production') {
    refuse('NODE_ENV=production. This writes thousands of rows; never run against prod.');
  }
  if (process.env['DEMO'] !== '1') {
    refuse('DEMO=1 is required. Set it explicitly to confirm this is a demo db.');
  }
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) refuse('DATABASE_URL is empty.');
  if (process.env['SCALE_FORCE'] === '1') return;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    refuse(`DATABASE_URL is not a valid URL: ${url}`);
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local && !/demo|test/i.test(url)) {
    refuse(`DATABASE_URL host "${host}" is not local and has no demo/test marker. Set SCALE_FORCE=1 to override.`);
  }
}

// ───── Deterministic helpers (mirrors seed-demo so ids line up) ──────────────

function detUuid(seed: string): string {
  const b = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function detToken(seed: string, len: number): string {
  let out = '';
  let i = 0;
  while (out.length < len) out += createHash('sha256').update(`${seed}:${i++}`).digest('base64url');
  return out.slice(0, len);
}

function detKey(seed: string): string {
  return createHash('sha256').update(seed).digest('base64');
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

// ───── Fleet definition for the extra nodes ─────────────────────────────────

// Countries an operator plausibly rents in, paired with the region the demo
// seed already created. Protocol rotates so every core is represented.
const FLEET: { cc: string; region: string }[] = [
  { cc: 'DE', region: 'EU' }, { cc: 'NL', region: 'EU' }, { cc: 'FR', region: 'EU' },
  { cc: 'SE', region: 'EU' }, { cc: 'FI', region: 'EU' }, { cc: 'PL', region: 'EU' },
  { cc: 'GB', region: 'EU' }, { cc: 'CH', region: 'EU' }, { cc: 'ES', region: 'EU' },
  { cc: 'US', region: 'US' }, { cc: 'CA', region: 'US' }, { cc: 'MX', region: 'US' },
  { cc: 'SG', region: 'AS' }, { cc: 'JP', region: 'AS' }, { cc: 'HK', region: 'AS' },
  { cc: 'AE', region: 'AS' }, { cc: 'TR', region: 'AS' }, { cc: 'IN', region: 'AS' },
  { cc: 'RU', region: 'RU' }, { cc: 'KZ', region: 'RU' },
];
const PROTOS = ['xray', 'hysteria', 'amneziawg', 'shadowsocks'] as const;
const PROTO_PREFIX: Record<string, string> = {
  xray: 'xray',
  hysteria: 'hy2',
  amneziawg: 'awg',
  shadowsocks: 'ss',
};
// Which demo profile lands on a node of each protocol, and on which port.
const PROFILE_FOR_PROTO: Record<string, { key: string; port: number }> = {
  xray: { key: 'vless-reality', port: 443 },
  hysteria: { key: 'hy2', port: 443 },
  amneziawg: { key: 'awg', port: 51820 },
  shadowsocks: { key: 'ss2022', port: 8388 },
};

// A few boxes that are not healthy, so the fleet page has something to show
// besides a wall of green.
const UNHEALTHY_EVERY = 7;

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
  const buckets = [
    { c: 18, m: 35, d: 25 },
    { c: 55, m: 70, d: 55 },
    { c: 88, m: 92, d: 82 },
    { c: 35, m: 50, d: 40 },
    { c: 71, m: 63, d: 68 },
  ];
  const s = sizes[idx % sizes.length]!;
  const b = buckets[idx % buckets.length]!;
  const cpuPct = Math.min(99, Math.max(1, b.c + rand(-6, 6)));
  const memPct = Math.min(99, Math.max(1, b.m + rand(-4, 4)));
  const diskPct = Math.min(99, Math.max(1, b.d + rand(-3, 3)));
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
    uptimeSeconds: 60 * 60 * 24 * (2 + (idx % 40)) + idx * 977,
    collectedAt: new Date().toISOString(),
  };
}

// ───── Nodes ────────────────────────────────────────────────────────────────

async function growNodes(): Promise<string[]> {
  const have = await prisma.node.count({ where: { deletedAt: null } });
  const missing = Math.max(0, TARGET_NODES - have);
  if (missing === 0) {
    console.log(`[nodes] already at ${have}, nothing to add`);
    return [];
  }
  console.log(`[nodes] have ${have}, adding ${missing}`);

  const regions = await prisma.region.findMany();
  const regionByCode = new Map(regions.map((r) => [r.code, r.id] as const));
  const profiles = await prisma.profile.findMany({ select: { id: true, name: true } });
  const profileByName = new Map(profiles.map((p) => [p.name, p.id] as const));

  /**
   * Stop here rather than build a fleet with nothing deployed on it.
   *
   * This script was written to run ON TOP of seed-demo, looking its profiles up
   * by name. seed-demo was removed on 2026-09-12 (commit 3b810dc, "drop the
   * demo build and its seeded fleet"), so those names now resolve to nothing and
   * the binding block below is skipped silently: hundreds of nodes appear, every
   * profile and host page reports zero reach, and the only clue is that the
   * numbers are wrong.
   *
   * That matters most exactly when it costs most. The migration rehearsal for an
   * operator with ~30k users is the reason to run this at all, and somebody
   * would spend a day on the panel before realising they were looking at
   * emptiness rather than at a bug in the panel.
   *
   * Loud, and it names what to do: creating the profiles is a decision (which
   * transports, which keys), not something a scale seeder should invent.
   */
  const wanted = [...new Set(Object.values(PROFILE_FOR_PROTO).map((p) => p.key))];
  const found = wanted.filter((k) => profileByName.has(k));
  if (found.length === 0) {
    throw new Error(
      `[nodes] none of the profiles this script binds exist: ${wanted.join(', ')}.\n` +
        `They came from seed-demo, which was removed in 3b810dc. Without them every node ` +
        `added here would be deployed to nothing, and the panel would look empty rather ` +
        `than broken.\nCreate profiles with those names first (any config), or edit ` +
        `PROFILE_FOR_PROTO to the names you do have.`,
    );
  }
  if (found.length < wanted.length) {
    console.warn(
      `[nodes] ⚠ only ${found.length} of ${wanted.length} profiles found (${found.join(', ')}). ` +
        `Nodes of the other protocols will be created with nothing deployed on them.`,
    );
  }

  const added: string[] = [];
  for (let i = 0; i < missing; i++) {
    const slot = FLEET[i % FLEET.length]!;
    const proto = PROTOS[i % PROTOS.length]!;
    // Two digits keep the name stable and readable even past the fleet length.
    const seq = String(Math.floor(i / FLEET.length) + 2).padStart(2, '0');
    const key = `${PROTO_PREFIX[proto]}-${slot.cc.toLowerCase()}-${seq}-s${i}`;
    const host = `${slot.cc.toLowerCase()}-${seq}-s${i}.example.com`;
    const id = detUuid(`scale-node:${key}`);

    // Every seventh box is not serving: one offline, the rest unreachable.
    const bad = i % UNHEALTHY_EVERY === UNHEALTHY_EVERY - 1;
    const status = bad ? (i % (UNHEALTHY_EVERY * 2) === UNHEALTHY_EVERY - 1 ? 'offline' : 'unreachable') : 'online';

    await prisma.node.create({
      data: {
        id,
        name: key,
        address: `${host}:1337`,
        protocol: proto,
        countryCode: slot.cc,
        status,
        lastStatusChange: new Date(Date.now() - rand(1, 96) * 3600 * 1000),
        lastStatusMessage: status === 'online' ? null : 'agent did not answer the last poll',
        // T7 gate: a slice of the fleet lags behind the cascade minimum so the
        // "upgrade when a host lands on them" warning has something to report.
        coreVersion: proto === 'xray' ? (i % 5 === 0 ? '24.12.18' : '26.3.27') : null,
        regionId: regionByCode.get(slot.region) ?? null,
        maxUsers: 1000,
        domain: proto === 'xray' ? host : null,
        heartbeatSecret: randomBytes(32),
      },
    });
    added.push(id);

    // Put the matching demo profile on the node so hosts/profiles pages count
    // real reach instead of showing a fleet nothing is deployed to.
    const want = PROFILE_FOR_PROTO[proto]!;
    const profileId = profileByName.get(want.key);
    if (profileId) {
      const bindingId = detUuid(`scale-binding:${key}`);
      await prisma.profileNodeBinding.create({
        data: {
          id: bindingId,
          profileId,
          nodeId: id,
          port: want.port,
          publicHost: host,
          publicPort: want.port,
          enabled: status === 'online',
        },
      });
      await prisma.host.create({
        data: { id: detUuid(`scale-host:${key}`), bindingId, remark: 'Direct', priority: 0, enabled: true },
      });
    }
  }
  return added;
}

// ───── Users ────────────────────────────────────────────────────────────────

// Distribution an operator actually sees: mostly active, a tail of limited /
// expired / disabled. Weights are out of 100.
const STATUS_MIX: { status: string; weight: number }[] = [
  { status: 'active', weight: 74 },
  { status: 'limited', weight: 9 },
  { status: 'expired', weight: 12 },
  { status: 'disabled', weight: 5 },
];
const STATUS_PICK: string[] = STATUS_MIX.flatMap((s) => Array<string>(s.weight).fill(s.status));

const TAGS = ['standard', 'premium', 'reseller', 'trial', null] as const;
const PROTOCOL_SETS: string[][] = [
  ['xray'],
  ['xray', 'hysteria'],
  ['xray', 'hysteria', 'shadowsocks'],
  ['hysteria'],
  ['xray', 'hysteria', 'shadowsocks', 'amneziawg'],
];

async function growUsers(): Promise<void> {
  const have = await prisma.user.count({ where: { deletedAt: null } });
  const missing = Math.max(0, TARGET_USERS - have);
  if (missing === 0) {
    console.log(`[users] already at ${have}, nothing to add`);
    return;
  }
  console.log(`[users] have ${have}, adding ${missing}`);

  // Spread users across the WHOLE fleet, not just the nodes this run created:
  // a top-up run adds no nodes, and pinning its users to an empty set would
  // leave them with no last-connected node at all. growNodes() returns only the
  // new ones, which is why it is not consulted here.
  const allNodes = await prisma.node.findMany({ where: { deletedAt: null }, select: { id: true } });
  const homePool = allNodes.map((n) => n.id);
  if (homePool.length === 0) {
    refuse('no nodes in the database. Run seed-demo first: users need a node to be attached to.');
  }
  const groups = await prisma.group.findMany({ select: { id: true, name: true } });

  const t0 = Date.now();
  for (let start = 0; start < missing; start += BATCH) {
    const end = Math.min(start + BATCH, missing);
    const users: Prisma.UserCreateManyInput[] = [];
    const traffic: { userId: string; usedTrafficBytes: bigint; lifetimeTrafficBytes: bigint; onlineAt: Date; firstConnectedAt: Date; lastConnectedNodeId: string }[] = [];
    const members: { groupId: string; userId: string }[] = [];

    for (let i = start; i < end; i++) {
      const n = have + i;
      const handle = `user${String(n).padStart(5, '0')}`;
      const id = detUuid(`scale-user:${handle}`);
      const status = pick(STATUS_PICK);
      const tag = pick(TAGS);

      // ~18% online right now, the rest scattered over the last two weeks.
      const onlineSec = Math.random() < 0.18 ? rand(5, 175) : rand(600, 14 * 24 * 3600);
      const limitGiB = Math.random() < 0.25 ? null : Math.round(rand(50, 1000) / 50) * 50;
      const usedGiB =
        status === 'limited' && limitGiB !== null ? limitGiB * rand(1.0, 1.05) : rand(0, limitGiB ?? 400) * 0.8;
      const expDays = status === 'expired' ? -rand(1, 60) : rand(3, 365);

      users.push({
        id,
        shortId: detToken(`scale-short:${handle}`, 12),
        username: handle,
        status,
        expireAt: new Date(Date.now() + expDays * 24 * 3600 * 1000),
        trafficLimitBytes: limitGiB === null ? null : BigInt(Math.round(limitGiB * GiB)),
        trafficLimitStrategy: pick(['no_reset', 'day', 'week', 'month']),
        subscriptionToken: detToken(`scale-sub:${handle}`, 48),
        hysteriaPassword: detToken(`scale-hy:${handle}`, 32),
        amneziawgPrivateKey: detKey(`scale-awgpriv:${handle}`),
        amneziawgPublicKey: detKey(`scale-awgpub:${handle}`),
        naivePassword: detToken(`scale-naive:${handle}`, 32),
        xrayUuid: randomUUID(),
        enabledProtocols: pick(PROTOCOL_SETS),
        hwidDeviceLimit: Math.random() < 0.3 ? Math.floor(rand(1, 6)) : null,
        tag,
      });

      traffic.push({
        userId: id,
        usedTrafficBytes: BigInt(Math.max(0, Math.round(usedGiB * GiB))),
        lifetimeTrafficBytes: BigInt(Math.max(0, Math.round(usedGiB * rand(1.5, 4) * GiB))),
        onlineAt: new Date(Date.now() - onlineSec * 1000),
        firstConnectedAt: new Date(Date.now() - rand(10, 400) * 24 * 3600 * 1000),
        lastConnectedNodeId: pick(homePool),
      });

      // Most users sit in exactly one squad, a minority in two.
      const first = pick(groups);
      members.push({ groupId: first.id, userId: id });
      if (groups.length > 1 && Math.random() < 0.22) {
        const second = groups.find((g) => g.id !== first.id);
        if (second) members.push({ groupId: second.id, userId: id });
      }
    }

    await prisma.user.createMany({ data: users, skipDuplicates: true });
    await prisma.userTraffic.createMany({ data: traffic, skipDuplicates: true });
    await prisma.groupMember.createMany({ data: members, skipDuplicates: true });
    process.stdout.write(`\r[users] ${end}/${missing}`);
  }
  console.log(`\n[users] done in ${Date.now() - t0}ms`);
}

// ───── Redis telemetry for the new boxes ────────────────────────────────────

async function seedRedis(newNodeIds: string[]): Promise<void> {
  if (newNodeIds.length === 0) return;
  const TTL = 24 * 3600;
  let i = 0;
  for (const id of newNodeIds) {
    await redis.set(nodeMetricsKey(id), JSON.stringify(buildSnapshot(i++)), 'EX', TTL);
  }
  await redis.del('dashboard:overview:v1');
}

// ───── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertSafe();
  console.log(`[seed:scale] target: ${TARGET_USERS} users, ${TARGET_NODES} nodes`);
  const newNodes = await growNodes();
  await growUsers();
  await seedRedis(newNodes);

  const [users, nodes, online] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.node.count({ where: { deletedAt: null } }),
    prisma.userTraffic.count({ where: { onlineAt: { gte: new Date(Date.now() - 180 * 1000) } } }),
  ]);
  console.log('\n[seed:scale] done.');
  console.log(`  users: ${users}   online now: ${online}`);
  console.log(`  nodes: ${nodes}`);
}

main()
  .catch((err) => {
    console.error('[seed:scale] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  });
