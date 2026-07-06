import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { getHeapStatistics } from 'node:v8';

export interface SystemMetrics {
  cpu: {
    /** % load: 1-min loadavg / cpu count, capped at 100. null on platforms
     *  without loadavg (Windows returns 0,0,0). */
    loadPercent: number | null;
    /** Sampled CPU% across all cores between two snapshots ~250ms apart. */
    samplePercent: number;
    cores: number;
    /** 1/5/15-min load averages, Linux/macOS. [0,0,0] on Windows. */
    loadavg: [number, number, number];
  };
  memory: {
    /** Total host RAM in bytes. */
    totalBytes: number;
    /** Used host RAM in bytes (total - free). */
    usedBytes: number;
    usedPercent: number;
  };
  disk: {
    /** Bytes total on the filesystem holding the panel's CWD. */
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
    /** Path that was probed (CWD). Surface for transparency. */
    path: string;
  } | null;
  process: {
    /** Resident set size of the panel process. */
    rssBytes: number;
    /** Heap used by V8. */
    heapUsedBytes: number;
    /** V8 heap_size_limit: the real cap (set by --max-old-space-size). Use
     *  this as the denominator for "how close to OOM are we" percentages.
     *  Do NOT use heapTotal from process.memoryUsage(): that's V8's lazily-
     *  grown current allocation, which sits just above heapUsed and produces
     *  a meaningless ~95% even when the real cap leaves gigabytes of room. */
    heapLimitBytes: number;
    /** Seconds since the panel started. */
    uptimeSeconds: number;
  };
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

function takeCpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

async function sampleCpuPercent(): Promise<number> {
  // 500ms window (was 200ms): a wider delta is less jittery on low-core
  // hosts. This sample is secondary detail now, the UI headlines the
  // load-average %; the extra 300ms is hidden behind the 30s overview cache.
  const a = takeCpuSnapshot();
  await new Promise((r) => setTimeout(r, 500));
  const b = takeCpuSnapshot();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (totalDelta <= 0) return 0;
  const pct = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, pct));
}

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const cpuList = cpus();
  const cores = cpuList.length;
  const la = loadavg() as [number, number, number];
  const loadPercent =
    la[0] === 0 && la[1] === 0 && la[2] === 0
      ? null
      : Math.min(100, (la[0] / Math.max(1, cores)) * 100);

  const samplePercent = await sampleCpuPercent();

  const total = totalmem();
  const free = freemem();
  const usedMem = total - free;

  let disk: SystemMetrics['disk'] = null;
  try {
    const path = process.cwd();
    const s = await statfs(path);
    const blockSize = Number(s.bsize);
    const totalBlocks = Number(s.blocks);
    const freeBlocks = Number(s.bavail);
    const totalBytes = blockSize * totalBlocks;
    const freeBytes = blockSize * freeBlocks;
    const usedBytes = totalBytes - freeBytes;
    disk = {
      totalBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
      path,
    };
  } catch {
    disk = null;
  }

  const mem = process.memoryUsage();
  const heap = getHeapStatistics();

  return {
    cpu: {
      loadPercent,
      samplePercent,
      cores,
      loadavg: la,
    },
    memory: {
      totalBytes: total,
      usedBytes: usedMem,
      usedPercent: total > 0 ? (usedMem / total) * 100 : 0,
    },
    disk,
    process: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapLimitBytes: heap.heap_size_limit,
      uptimeSeconds: Math.round(process.uptime()),
    },
  };
}
