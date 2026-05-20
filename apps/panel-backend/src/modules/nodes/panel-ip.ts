import { config } from '../../config.js';

// Slice S7 — auto-detected outbound IP of the panel, used to inject the
// `--panel-ip` flag into the node-install command so the agent's UFW
// allows :1337/tcp ONLY from this address.
//
// Resolution order:
//   1. PANEL_PUBLIC_IP env (operator override — wins always)
//   2. Cached probe result (in-memory, refreshed every 30 min)
//   3. Probe https://api.ipify.org / https://icanhazip.com (first to win)
//   4. null  → renderBootstrapCommand emits a YOUR_PANEL_PUBLIC_IP token
//
// Why outbound probe instead of DNS-resolving PUBLIC_URL: when the panel
// is behind Cloudflare Proxied (orange cloud), the DNS lookup returns a
// CF edge IP, but UFW on the node needs the panel's *origin* IP that
// actually originates the mTLS connection. ipify reports the egress IP
// the rest of the internet sees, which is exactly what we want.

const PROBES = [
  'https://api.ipify.org',
  'https://icanhazip.com',
  'https://ifconfig.me/ip',
];
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — IPs are stable; tradeoff is recovery time after a re-IP
const PROBE_TIMEOUT_MS = 3_000;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

interface CacheEntry {
  ip: string;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<string | null> | null = null;

async function probeOnce(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'User-Agent': 'Iceslab/1.0 (panel-ip probe)' },
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    // Sanity-check the response — these services are simple but a hijacked
    // proxy / DNS could return something else; we only trust IP-shaped tokens.
    if (IPV4_RE.test(text) || IPV6_RE.test(text)) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

async function probeAll(): Promise<string | null> {
  for (const url of PROBES) {
    const ip = await probeOnce(url);
    if (ip) return ip;
  }
  return null;
}

/**
 * Returns the panel's egress IP (env override > cached probe > fresh probe).
 * Never throws — failures collapse to `null` and the caller falls back to
 * an instructional placeholder in the install command.
 */
export async function getPanelPublicIp(): Promise<string | null> {
  if (config.PANEL_PUBLIC_IP) return config.PANEL_PUBLIC_IP;

  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.ip;
  }

  // Coalesce concurrent callers — one node-create burst shouldn't trigger
  // N parallel probes against ipify.
  if (inflight) return inflight;
  inflight = (async () => {
    const ip = await probeAll();
    if (ip) {
      cache = { ip, fetchedAt: Date.now() };
    }
    inflight = null;
    return ip;
  })();
  return inflight;
}
