/**
 * Demo-metrics seeder: pushes plausible drifting CPU/RAM/disk values into
 * Redis at the same key the dashboard reads (node:metrics:<id>) so the UI
 * shows realistic per-node load without spinning up real VPS.
 *
 * Run:
 *   pnpm --filter @iceslab/panel-backend demo:metrics
 *
 * Optional flags:
 *   --scenario=mixed    (default) each node drifts independently across
 *                       a different baseline: calm / busy / critical
 *   --scenario=calm     all nodes around 10-30%
 *   --scenario=busy     all nodes around 50-70%
 *   --scenario=critical all nodes around 85-98%, exercises red thresholds
 *   --interval=5        seconds between pushes (default 5)
 *   --create=N          create N additional fake nodes in DB before starting,
 *                       cleaned up on Ctrl+C (only nodes this run created)
 *
 * Stops on Ctrl+C, Redis entries TTL out within 60s, so the dashboard goes
 * back to "-" automatically. If --create was used, those rows are deleted on
 * exit.
 *
 * Note: this writes ONLY to Redis, never to NodeUsageHistory or any other
 * persistent table. The "Сегодня" column won't move because that's real
 * traffic accounting; the per-node CPU/RAM/Disk bars will animate.
 */
import { randomUUID } from 'node:crypto';
import { redis } from '../src/lib/redis.js';
import { prisma } from '../src/prisma.js';
import { nodeMetricsKey } from '../src/modules/nodes/nodes.cron.js';

type Scenario = 'mixed' | 'calm' | 'busy' | 'critical';

interface Args {
  scenario: Scenario;
  intervalSec: number;
  createCount: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { scenario: 'mixed', intervalSec: 5, createCount: 0 };
  for (const a of argv) {
    if (a.startsWith('--scenario=')) {
      const v = a.slice('--scenario='.length) as Scenario;
      if (['mixed', 'calm', 'busy', 'critical'].includes(v)) out.scenario = v;
    } else if (a.startsWith('--interval=')) {
      const v = Number(a.slice('--interval='.length));
      if (Number.isFinite(v) && v > 0) out.intervalSec = v;
    } else if (a.startsWith('--create=')) {
      const v = Number(a.slice('--create='.length));
      if (Number.isFinite(v) && v >= 0) out.createCount = Math.floor(v);
    }
  }
  return out;
}

interface Profile {
  baseCPU: number;
  baseMem: number;
  baseDisk: number;
  cores: number;
  totalRamBytes: number;
  totalDiskBytes: number;
  /** Per-node phase offset so all nodes don't pulse in unison. */
  phase: number;
}

const GiB = 1024 ** 3;

function pickProfile(scenario: Scenario, idx: number): Profile {
  // RAM/disk capacities chosen to look like real VPS sizes.
  const sizes = [
    { ram: 2 * GiB, disk: 20 * GiB, cores: 2 },
    { ram: 4 * GiB, disk: 40 * GiB, cores: 2 },
    { ram: 8 * GiB, disk: 80 * GiB, cores: 4 },
    { ram: 16 * GiB, disk: 160 * GiB, cores: 8 },
  ];
  const s = sizes[idx % sizes.length];

  let baseCPU: number;
  let baseMem: number;
  let baseDisk: number;
  if (scenario === 'calm') {
    baseCPU = 15;
    baseMem = 30;
    baseDisk = 25;
  } else if (scenario === 'busy') {
    baseCPU = 60;
    baseMem = 65;
    baseDisk = 55;
  } else if (scenario === 'critical') {
    baseCPU = 90;
    baseMem = 92;
    baseDisk = 85;
  } else {
    // mixed: rotate through buckets per node so the table shows green/yellow/red
    const buckets = [
      { c: 18, m: 35, d: 25 },
      { c: 55, m: 70, d: 55 },
      { c: 88, m: 92, d: 85 },
      { c: 35, m: 50, d: 40 },
    ];
    const b = buckets[idx % buckets.length];
    baseCPU = b.c;
    baseMem = b.m;
    baseDisk = b.d;
  }

  return {
    baseCPU,
    baseMem,
    baseDisk,
    cores: s.cores,
    totalRamBytes: s.ram,
    totalDiskBytes: s.disk,
    phase: (idx * 17) % 360,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function drift(base: number, phase: number, t: number, amp = 8): number {
  // Smooth sine + small jitter, looks alive, never quite still.
  const wave = Math.sin((t / 7 + phase) * (Math.PI / 30)) * amp;
  const jitter = (Math.random() - 0.5) * 4;
  return clamp(base + wave + jitter, 1, 99);
}

async function pushSnapshot(
  nodeId: string,
  p: Profile,
  tickIndex: number,
  startedAt: Date,
): Promise<void> {
  const cpuPct = drift(p.baseCPU, p.phase, tickIndex);
  const memPct = drift(p.baseMem, p.phase + 30, tickIndex, 4);
  // Disk usage drifts slowly (rate of change of disk fill in the real world
  // is on the order of MB/min, not %/sec), small amplitude.
  const diskPct = drift(p.baseDisk, p.phase + 60, tickIndex, 1);

  const memUsed = Math.floor((memPct / 100) * p.totalRamBytes);
  const memAvail = p.totalRamBytes - memUsed;
  const diskUsed = Math.floor((diskPct / 100) * p.totalDiskBytes);

  // Loadavg roughly tracks CPU% scaled by core count (typical: 1 core fully
  // busy ≈ loadavg 1.0). Add a touch of jitter for credibility.
  const la1 = Number(((cpuPct / 100) * p.cores + (Math.random() - 0.5) * 0.2).toFixed(2));
  const la5 = Number((la1 * 0.85 + (Math.random() - 0.5) * 0.15).toFixed(2));
  const la15 = Number((la1 * 0.7 + (Math.random() - 0.5) * 0.1).toFixed(2));

  const uptimeSec = Math.floor((Date.now() - startedAt.getTime()) / 1000) + 60 * 60 * 24 * 3;

  const snap = {
    cpu: {
      usagePercent: Number(cpuPct.toFixed(1)),
      loadAvg1: Math.max(0, la1),
      loadAvg5: Math.max(0, la5),
      loadAvg15: Math.max(0, la15),
      cores: p.cores,
    },
    memory: {
      totalBytes: p.totalRamBytes,
      availableBytes: memAvail,
      usedBytes: memUsed,
      usedPercent: Number(memPct.toFixed(1)),
    },
    disk: {
      path: '/',
      totalBytes: p.totalDiskBytes,
      usedBytes: diskUsed,
      usedPercent: Number(diskPct.toFixed(1)),
    },
    uptimeSeconds: uptimeSec,
    collectedAt: new Date().toISOString(),
  };

  await redis.set(nodeMetricsKey(nodeId), JSON.stringify(snap), 'EX', 60);
}

async function createFakeNodes(count: number): Promise<string[]> {
  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const seq = Date.now().toString(36).slice(-4) + '-' + i;
    await prisma.node.create({
      data: {
        id,
        name: `demo-${seq}`,
        address: `127.0.0.1:${30000 + i}`,
        protocol: 'xray',
        countryCode: ['US', 'NL', 'DE', 'JP', 'SE'][i % 5],
        status: 'online',
      },
    });
    created.push(id);
  }
  if (count > 0) console.log(`[demo-metrics] created ${count} fake node row(s)`);
  return created;
}

async function deleteFakeNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.node.deleteMany({ where: { id: { in: ids } } });
  console.log(`[demo-metrics] cleaned up ${ids.length} fake node row(s)`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[demo-metrics] scenario=${args.scenario} interval=${args.intervalSec}s create=${args.createCount}`,
  );

  const created = await createFakeNodes(args.createCount);

  const nodes = await prisma.node.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  if (nodes.length === 0) {
    console.error(
      '[demo-metrics] no nodes in DB. Pass --create=4 to spawn fake ones, or add real nodes first.',
    );
    await prisma.$disconnect();
    await redis.quit();
    process.exit(1);
  }
  console.log(`[demo-metrics] driving ${nodes.length} node(s):`);
  for (const n of nodes) console.log(`  · ${n.name}`);

  const profiles = nodes.map((_, i) => pickProfile(args.scenario, i));
  const startedAt = new Date();
  let tick = 0;

  // Push immediately so the dashboard fills in on first refresh, then on interval.
  const drive = async (): Promise<void> => {
    tick++;
    await Promise.all(
      nodes.map((n, i) => pushSnapshot(n.id, profiles[i], tick, startedAt)),
    );
    process.stdout.write(`\r[demo-metrics] tick ${tick} pushed at ${new Date().toLocaleTimeString()} `);
  };
  await drive();
  const timer = setInterval(() => {
    drive().catch((err) => console.error('\n[demo-metrics] push failed:', err));
  }, args.intervalSec * 1000);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[demo-metrics] stopping…');
    clearInterval(timer);
    // Drop cached snapshots immediately so the UI doesn't show stale fake data.
    await Promise.all(nodes.map((n) => redis.del(nodeMetricsKey(n.id))));
    await deleteFakeNodes(created);
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error('[demo-metrics] fatal:', err);
  await prisma.$disconnect().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  process.exit(1);
});
