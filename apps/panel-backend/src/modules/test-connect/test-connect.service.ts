import { connect as netConnect, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { lookup } from 'node:dns/promises';
import { prisma } from '../../prisma.js';
import { hostFromAddress } from '../subscription/subscription.formats.js';
import { isPublicRoutableIp } from '../../lib/ip.js';

export interface ProbeResult {
  bindingId: string;
  hostId: string | null;
  hostRemark: string;
  protocol: string;
  nodeName: string;
  // Effective endpoint we probed (after binding + host overrides).
  endpoint: string;
  port: number;
  // What kind of probe ran: tcp / tls / skip.
  probe: 'tcp' | 'tls' | 'skip';
  // K10: what we probed: the client-facing `endpoint`, or the REALITY
  // `dest` (the masquerade target the NODE borrows its handshake from).
  // A dead/non-TLS1.3 dest silently breaks REALITY (caught cdn3-87.yahoo.com
  // = NXDOMAIN live 2026-06-11), so we surface it before the admin deploys.
  kind: 'endpoint' | 'dest';
  // For TLS probes: SNI we sent. Lets admins eyeball the masquerade target.
  sni?: string;
  ok: boolean;
  latencyMs?: number;
  // TLS-only: peer cert subject CN. For REALITY this should match the
  // masquerade target (apple.com, etc), NOT the panel's own host.
  certCn?: string;
  // TLS-only: negotiated protocol version (e.g. "TLSv1.3"). REALITY REQUIRES
  // the dest to speak TLS 1.3; a 1.2-only dest is a silent mis-config.
  tlsVersion?: string;
  // H1 (dest only) - negotiated ALPN (e.g. "h2"). A CDN-grade REALITY dest
  // speaks HTTP/2; a dest without h2 is a weaker, more detectable masquerade.
  alpn?: string;
  error?: string;
  // Hint for the UI when we couldn't run a real probe (UDP-based
  // protocols fall back to a TCP port reachability check, which is
  // less informative, we annotate so admins don't misread a green tick).
  notes?: string;
}

/** Default for `?timeout=`, keep low so a hung probe doesn't stall the response. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * K10: parse a REALITY dest string ("host:port") + the profile's serverNames
 * into a probe target. The SNI we claim is serverNames[0] (what the client
 * sends), falling back to the dest host. Exported for unit testing; the TLS
 * probe itself is network I/O and is validated in the field.
 */
export function parseRealityDestTarget(
  destRaw: string,
  serverNames: string[] | undefined,
): { host: string; port: number; sni: string } | null {
  if (!destRaw) return null;
  const sep = destRaw.lastIndexOf(':');
  const host = sep > 0 ? destRaw.slice(0, sep) : destRaw;
  const portNum = sep > 0 ? Number(destRaw.slice(sep + 1)) : 443;
  const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 443;
  const first = serverNames?.[0];
  const sni = typeof first === 'string' && first.length > 0 ? first : host;
  return { host, port, sni };
}

/**
 * H1 - turn what the dest TLS probe observed into a health note, or undefined
 * when the dest looks CDN-grade. A good REALITY masquerade target speaks BOTH
 * TLS 1.3 (REALITY borrows its ServerHello) AND HTTP/2 (real CDNs do; a dest
 * without h2 stands out under behavioral DPI). Pure, so it stays unit-tested
 * while the TLS probe itself is field-validated. `alpn` undefined = not probed
 * (skip the h2 check); '' = probed but the dest negotiated no ALPN.
 */
export function realityDestNote(
  tlsVersion: string | undefined,
  alpn: string | undefined,
): string | undefined {
  const issues: string[] = [];
  if (tlsVersion !== undefined && tlsVersion !== 'TLSv1.3') {
    issues.push(`negotiated ${tlsVersion}, REALITY needs TLS 1.3`);
  }
  if (alpn !== undefined && alpn !== 'h2') {
    issues.push(`no HTTP/2 (ALPN ${alpn || 'absent'}); a CDN-grade dest speaks h2`);
  }
  if (issues.length === 0) return undefined;
  return `REALITY dest: ${issues.join('; ')}. Prefer a major CDN that supports TLS 1.3 + HTTP/2.`;
}

const TLS_PROTOCOLS = new Set(['xray', 'naive']);
// UDP-based: TCP probe doesn't actually validate the protocol, but it does
// check the route + firewall. Admin gets a yellow note pointing this out.
const UDP_PROTOCOLS = new Set(['hysteria', 'amneziawg', 'mieru']);

/**
 * Probe a single (binding, host) target. Returns within `PROBE_TIMEOUT_MS`
 * even on a hung peer, never throws.
 */
async function probe(target: {
  bindingId: string;
  hostId: string | null;
  hostRemark: string;
  protocol: string;
  nodeName: string;
  endpoint: string;
  port: number;
  sni: string | null;
  isUdp: boolean;
  isTls: boolean;
  kind: 'endpoint' | 'dest';
  // H1 - ALPN protocols to offer (the dest probe offers h2 to read what the
  // masquerade target negotiates). Unset on endpoint probes.
  alpn?: string[];
}): Promise<ProbeResult> {
  const base: Pick<ProbeResult, 'bindingId' | 'hostId' | 'hostRemark' | 'protocol' | 'nodeName' | 'endpoint' | 'port' | 'kind'> = {
    bindingId: target.bindingId,
    hostId: target.hostId,
    hostRemark: target.hostRemark,
    protocol: target.protocol,
    nodeName: target.nodeName,
    endpoint: target.endpoint,
    port: target.port,
    kind: target.kind,
  };

  // SSRF guard. The probe target is admin/profile-controlled (binding.publicHost,
  // host.addressOverride, node.address, realityDest) and a scoped `profiles:write`
  // API token can set it, so without this a token could aim test-connect at
  // loopback / private / link-local / cloud-metadata (169.254.169.254) and read
  // ok/latency/error as an internal port scanner + metadata oracle. Resolve the
  // host and refuse any non-routable resolved address. (A public name that
  // rebinds to a private IP between here and the connect is a documented
  // residual; the win is blocking literal internal targets and internal names.)
  const blockReason = await checkTargetRoutable(target.endpoint);
  if (blockReason) {
    return { ...base, probe: 'skip', ok: false, error: blockReason };
  }

  // TLS probe: for REALITY/xray and Naive. We disable cert-chain validation
  // because (a) REALITY uses a borrowed cert chain we can't pre-trust, and
  // (b) self-hosted Naive often runs ACME staging during development. The
  // useful signal is "did the handshake complete?" + the peer CN, not a
  // valid chain.
  if (target.isTls && target.sni) {
    const start = Date.now();
    return await new Promise<ProbeResult>((resolve) => {
      const sock = tlsConnect({
        host: target.endpoint,
        port: target.port,
        servername: target.sni!,
        rejectUnauthorized: false,
        // H1: offer ALPN for the dest probe so we can read what the masquerade
        // target negotiates (a CDN-grade dest speaks h2). Endpoint probes leave
        // it unset so the server picks as before.
        ...(target.alpn ? { ALPNProtocols: target.alpn } : {}),
      });
      const onResult = (r: ProbeResult) => {
        sock.destroy();
        resolve(r);
      };
      const t = setTimeout(() => {
        onResult({
          ...base,
          probe: 'tls',
          sni: target.sni ?? undefined,
          ok: false,
          error: `TLS handshake timeout after ${PROBE_TIMEOUT_MS}ms`,
        });
      }, PROBE_TIMEOUT_MS);
      sock.once('secureConnect', () => {
        clearTimeout(t);
        const cert = sock.getPeerCertificate();
        const subjectCn = cert?.subject?.CN;
        const sanRaw = cert?.subjectaltname;
        const cn =
          (typeof subjectCn === 'string' && subjectCn.length > 0
            ? subjectCn
            : Array.isArray(sanRaw)
              ? sanRaw.join(', ')
              : typeof sanRaw === 'string'
                ? sanRaw
                : undefined) || undefined;
        const tlsVersion = sock.getProtocol() ?? undefined;
        // H1 - for the dest probe, read the negotiated ALPN and build a health
        // note covering BOTH TLS 1.3 (REALITY borrows the dest ServerHello) and
        // HTTP/2 (a CDN-grade dest speaks h2). An endpoint's TLS version / ALPN
        // is the client's own and irrelevant here, so we only annotate the dest.
        const negotiatedAlpn =
          target.kind === 'dest'
            ? sock.alpnProtocol === false || sock.alpnProtocol == null
              ? ''
              : sock.alpnProtocol
            : undefined;
        const destNote =
          target.kind === 'dest' ? realityDestNote(tlsVersion, negotiatedAlpn) : undefined;
        onResult({
          ...base,
          probe: 'tls',
          sni: target.sni ?? undefined,
          ok: true,
          latencyMs: Date.now() - start,
          certCn: cn,
          tlsVersion,
          ...(negotiatedAlpn !== undefined ? { alpn: negotiatedAlpn } : {}),
          ...(destNote ? { notes: destNote } : {}),
        });
      });
      sock.once('error', (err) => {
        clearTimeout(t);
        onResult({
          ...base,
          probe: 'tls',
          sni: target.sni ?? undefined,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  // TCP probe: fallback for everything else. For UDP-based protocols we
  // attach a `notes` field so the UI doesn't lie about what was tested.
  const start = Date.now();
  return await new Promise<ProbeResult>((resolve) => {
    const sock = netConnect({ host: target.endpoint, port: target.port });
    const onResult = (r: ProbeResult) => {
      sock.destroy();
      resolve(r);
    };
    const t = setTimeout(() => {
      onResult({
        ...base,
        probe: 'tcp',
        ok: false,
        error: `TCP connect timeout after ${PROBE_TIMEOUT_MS}ms`,
        ...(target.isUdp ? { notes: 'UDP-based protocol: tested TCP port reachability only.' } : {}),
      });
    }, PROBE_TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(t);
      onResult({
        ...base,
        probe: 'tcp',
        ok: true,
        latencyMs: Date.now() - start,
        ...(target.isUdp ? { notes: 'UDP-based protocol: TCP reachability only; for full validation install client and try connecting.' } : {}),
      });
    });
    sock.once('error', (err) => {
      clearTimeout(t);
      onResult({
        ...base,
        probe: 'tcp',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ...(target.isUdp ? { notes: 'UDP-based protocol: tested TCP port reachability only.' } : {}),
      });
    });
  });
}

/**
 * Run probes for every (enabled) binding × host of the given profile,
 * concurrently. Returns one row per probe. Order is deterministic
 * (binding.port asc, then host.priority asc) so the UI can render a
 * stable list across re-runs.
 */
export async function testProfileConnect(profileId: string): Promise<ProbeResult[]> {
  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile) {
    throw new Error('Profile not found');
  }

  const bindings = await prisma.profileNodeBinding.findMany({
    where: { profileId, enabled: true, node: { deletedAt: null } },
    include: {
      node: { select: { name: true, address: true } },
      hosts: { where: { enabled: true }, orderBy: [{ priority: 'asc' }] },
    },
    orderBy: [{ port: 'asc' }],
  });

  const isTls = TLS_PROTOCOLS.has(profile.protocol);
  const isUdp = UDP_PROTOCOLS.has(profile.protocol);
  const protocolConfig = (profile.config ?? {}) as Record<string, unknown>;

  const targets: Parameters<typeof probe>[0][] = [];

  for (const b of bindings) {
    const baseHost = b.publicHost ?? hostFromAddress(b.node.address);
    const basePort = b.publicPort ?? b.port;
    const profileSni = (() => {
      const names = (protocolConfig.realityServerNames as string[] | undefined) ?? [];
      return typeof names[0] === 'string' ? names[0] : null;
    })();

    const hostRows = b.hosts.length > 0 ? b.hosts : [null];
    for (const h of hostRows) {
      const endpoint = h?.addressOverride ?? baseHost;
      const port = h?.portOverride ?? basePort;
      const sni = h?.sniOverride ?? profileSni ?? endpoint;
      targets.push({
        bindingId: b.id,
        hostId: h?.id ?? null,
        hostRemark: h?.remark ?? 'Default',
        protocol: profile.protocol,
        nodeName: b.node.name,
        endpoint,
        port,
        sni: isTls ? sni : null,
        isUdp,
        isTls,
        kind: 'endpoint',
      });
    }
  }

  // K10: probe the REALITY dest (the masquerade target the NODE borrows its
  // TLS 1.3 handshake from). A dead domain (cdn3-87.yahoo.com was NXDOMAIN
  // live 2026-06-11) or a 1.2-only dest silently breaks REALITY; surface it
  // before deploy. One probe per profile (the dest is profile-level, shared
  // by every binding). The probe runs from the panel, so it catches a dead
  // dest / wrong TLS version, though node->dest reachability can still differ.
  if (profile.protocol === 'xray') {
    const destRaw =
      typeof protocolConfig.realityDest === 'string' ? protocolConfig.realityDest : '';
    const names = (protocolConfig.realityServerNames as string[] | undefined) ?? [];
    const dest = parseRealityDestTarget(destRaw, names);
    if (dest) {
      targets.unshift({
        bindingId: 'reality-dest',
        hostId: null,
        hostRemark: 'REALITY dest',
        protocol: profile.protocol,
        nodeName: '-',
        endpoint: dest.host,
        port: dest.port,
        sni: dest.sni,
        isUdp: false,
        isTls: true,
        kind: 'dest',
        // H1: offer h2 so the probe can verify the dest speaks HTTP/2.
        alpn: ['h2', 'http/1.1'],
      });
    }
  }

  // Run all probes in parallel, each is bounded by PROBE_TIMEOUT_MS so
  // the worst-case latency of the response is ~1× timeout regardless of
  // how many bindings the profile has.
  return await Promise.all(targets.map((t) => probe(t)));
}

/**
 * Return a refusal reason if a probe target host is NOT a publicly routable
 * address, else null. IP literals are checked directly; hostnames are resolved
 * (all addresses) and every resolved IP must be routable. A DNS failure is a
 * refusal rather than an unchecked connect. Backs the SSRF guard in probe.
 */
async function checkTargetRoutable(host: string): Promise<string | null> {
  let addrs: string[];
  if (isIP(host)) {
    addrs = [host];
  } else {
    try {
      addrs = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      return `could not resolve ${host}`;
    }
    if (addrs.length === 0) return `could not resolve ${host}`;
  }
  for (const a of addrs) {
    if (!isPublicRoutableIp(a)) {
      return `${host} resolves to a non-routable address (${a}); refused`;
    }
  }
  return null;
}
