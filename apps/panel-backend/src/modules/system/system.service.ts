import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ROADMAP D1: "update available" check. Compares the running panel version
 * against the latest GitHub release tag. Best-effort by design: the panel must
 * never break (or even slow down a request) because GitHub is unreachable, so
 * every failure path degrades to `latest: null` / `updateAvailable: false`.
 */

// Repo to check. Override via env for forks / self-hosted mirrors.
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'icecompany-tech/iceslab';
// The repo is private, so the releases API needs a token to return a tag.
// Without it the check simply degrades to "unknown latest" (no nag, no error).
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const CHECK_TTL_MS = 6 * 60 * 60 * 1000; // re-check GitHub at most every 6h
const FETCH_TIMEOUT_MS = 4000;

let currentVersionCache: string | null = null;

function readCurrentVersion(): string {
  if (currentVersionCache) return currentVersionCache;
  // The process runs with cwd = the backend package dir in both dev
  // (`pnpm --filter @iceslab/panel-backend start`) and the Docker image
  // (WORKDIR /app/apps/panel-backend), so its package.json is a stable,
  // dependency-free source of truth for the running version.
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { version?: string };
    currentVersionCache = pkg.version ?? 'unknown';
  } catch {
    currentVersionCache = process.env.APP_VERSION ?? 'unknown';
  }
  return currentVersionCache;
}

interface LatestCache {
  latest: string | null;
  releaseUrl: string | null;
  checkedAt: number; // epoch ms
}
let latestCache: LatestCache | null = null;
let inflight: Promise<LatestCache> | null = null;

/** Strip a leading v, drop any pre-release/build suffix, split to numbers. */
function parseSemver(v: string): number[] {
  const core = v.replace(/^v/i, '').split(/[-+]/)[0];
  return core.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** True when `latest` is strictly newer than `current` (numeric major.minor.patch). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchLatest(): Promise<LatestCache> {
  const checkedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'iceslab-panel',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { latest: null, releaseUrl: null, checkedAt };
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    const tag = body.tag_name?.trim() || null;
    return { latest: tag, releaseUrl: body.html_url ?? null, checkedAt };
  } catch {
    // network / abort / parse: degrade silently.
    return { latest: null, releaseUrl: null, checkedAt };
  }
}

async function getLatest(): Promise<LatestCache> {
  if (latestCache && Date.now() - latestCache.checkedAt < CHECK_TTL_MS) {
    return latestCache;
  }
  // Single-flight: collapse concurrent refreshes into one GitHub call.
  if (!inflight) {
    inflight = fetchLatest().then((r) => {
      latestCache = r;
      inflight = null;
      return r;
    });
  }
  return inflight;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: string | null;
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const current = readCurrentVersion();
  const { latest, releaseUrl, checkedAt } = await getLatest();
  const updateAvailable = latest != null && current !== 'unknown' && isNewer(latest, current);
  return {
    current,
    latest,
    updateAvailable,
    releaseUrl,
    checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
  };
}
