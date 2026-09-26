import type { AwgGeometry3 } from '@iceslab/shared';

/**
 * Client-side wg-quick config builder for AmneziaWG.
 *
 * AmneziaWG uses the same `[Interface]` / `[Peer]` ini format as upstream
 * WireGuard plus extra obfuscation directives (Jc/Jmin/Jmax, S1-S4, H1-H4).
 * The official `awg` client and any AmneziaWG-aware app (Hiddify v2.4+,
 * AmneziaVPN-app, mobile clients) parse this directly.
 *
 * Output is a plain text blob, no URL form like vless/hysteria. Subscription
 * generators wrap it in their preferred container (raw .conf file, base64
 * blob, JSON `endpoints[].config`).
 *
 * The obfuscation params MUST match the server inbound's interface block,
 * the panel pulls them from the same source (env in slice 19, inbounds table
 * in slice 23).
 */

export interface AmneziawgClientConfigOpts {
  /** User's WireGuard private key (base64, 32 bytes). */
  privateKey: string;
  /**
   * IP allocated to this user inside the inbound's subnet, in CIDR /32 form
   * (e.g. "10.0.0.42/32"). Caller should already have appended the suffix.
   */
  allowedIp: string;
  /** Server's WireGuard public key (base64, 32 bytes). */
  serverPublicKey: string;
  /** Public host the client connects to (no port). */
  host: string;
  /** Public UDP port the AmneziaWG inbound listens on. */
  port: number;

  /** Junk packet count (Jc). */
  jc: number;
  /** Min junk packet size. */
  jmin: number;
  /** Max junk packet size. */
  jmax: number;
  /** Magic header sizes, must match the inbound. */
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  /** Magic header values, must match the inbound. */
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  /**
   * I1-I5: optional v2.0 mimicry packets (hex strings, empty = disabled).
   * MUST match the server inbound's values verbatim; the AmneziaWG
   * handshake hashes them in, so any mismatch silently breaks decryption.
   */
  i1?: string;
  i2?: string;
  i3?: string;
  i4?: string;
  i5?: string;

  /**
   * t07-6c: the node's 3.1 geometry, for a 3.1 profile. When set it REPLACES
   * jc..i5 above: a 3.1 client has to carry exactly what the node's awg3
   * interface runs (headers as ranges, HeaderProtectionKey, the timings,
   * RandomTrailers), and the profile's 1.x numbers are not that.
   */
  geometry3?: AwgGeometry3;

  /**
   * Routes the client tunnels through the VPN. Default `0.0.0.0/0,::/0`
   * (full tunnel). Pass `[]` for split-tunnel split-by-app on Android, etc.
   */
  clientAllowedIps?: string[];
  /**
   * Optional DNS pushed to the client. Default empty (client uses system DNS).
   */
  dns?: string[];
  /**
   * Persistent keepalive seconds. Default 25, practical for NAT-traversal,
   * matches AmneziaVPN-app default.
   */
  persistentKeepalive?: number;
}

/**
 * The 3.1 client block, key for key what the node's awg3 interface runs
 * (the agent's Geometry3.interfaceLines), as the 3.1 tools and AmneziaVPN
 * 5.x read them (amnezia-client configKeys.h:97-104). Values are the
 * geometry's own strings: a range stays "lo-hi".
 */
export function awg3ClientLines(g: AwgGeometry3): [string, string][] {
  const lines: [string, string][] = [
    ['Jc', `${g.jc}`],
    ['Jmin', `${g.jmin}`],
    ['Jmax', `${g.jmax}`],
    ['S1', `${g.s1}`],
    ['S2', `${g.s2}`],
    ['S3', `${g.s3}`],
    ['S4', `${g.s4}`],
    ['H1', g.h1],
    ['H2', g.h2],
    ['H3', g.h3],
    ['H4', g.h4],
  ];
  [g.i1, g.i2, g.i3, g.i4, g.i5].forEach((v, i) => {
    if (v) lines.push([`I${i + 1}`, v]);
  });
  return [
    ...lines,
    ['HeaderProtectionKey', g.headerProtectionKey],
    ['ContentPaddingAddition', g.contentPaddingAddition],
    ['RekeyAfterTime', g.rekeyAfterTime],
    ['RekeyTimeout', g.rekeyTimeout],
    ['RejectAfterTime', g.rejectAfterTime],
    ['KeepaliveTimeout', g.keepaliveTimeout],
    ['MaxHandshakeAttempts', g.maxHandshakeAttempts],
    // Fleet-wide constant, the same on the node: both ends must agree.
    ['RandomTrailers', 'on'],
  ];
}

export function buildAmneziawgClientConfig(opts: AmneziawgClientConfigOpts): string {
  const allowed = (opts.clientAllowedIps?.length ? opts.clientAllowedIps : ['0.0.0.0/0', '::/0']).join(', ');
  const lines: string[] = [];

  lines.push('[Interface]');
  lines.push(`PrivateKey = ${opts.privateKey}`);
  lines.push(`Address = ${opts.allowedIp}`);
  if (opts.dns?.length) {
    lines.push(`DNS = ${opts.dns.join(', ')}`);
  }
  if (opts.geometry3) {
    // The MTU the geometry was minted for: S4 is paid out of it on this end
    // too, so a larger client MTU fragments full-size packets.
    lines.push(`MTU = ${opts.geometry3.mtu}`);
    for (const [k, v] of awg3ClientLines(opts.geometry3)) lines.push(`${k} = ${v}`);
    return peerBlock(lines, opts, allowed);
  }
  lines.push(`Jc = ${opts.jc}`);
  lines.push(`Jmin = ${opts.jmin}`);
  lines.push(`Jmax = ${opts.jmax}`);
  lines.push(`S1 = ${opts.s1}`);
  lines.push(`S2 = ${opts.s2}`);
  // S3/S4 are AmneziaWG 2.0-only, emitted only when non-zero. The AmneziaVPN
  // iOS network extension (checked on 4.8.19) cannot parse these keys at all,
  // even at 0, and aborts with ParseError 9. Omitting them keeps a 1.x-shaped
  // config that every client accepts, and a real 2.0 setup still gets them.
  if (opts.s3) lines.push(`S3 = ${opts.s3}`);
  if (opts.s4) lines.push(`S4 = ${opts.s4}`);
  lines.push(`H1 = ${opts.h1}`);
  lines.push(`H2 = ${opts.h2}`);
  lines.push(`H3 = ${opts.h3}`);
  lines.push(`H4 = ${opts.h4}`);
  // Emit I1-I5 only when set, empty values mean "no mimicry packet
  // for that slot" and the awg client rejects empty hex.
  for (const [idx, val] of [opts.i1, opts.i2, opts.i3, opts.i4, opts.i5].entries()) {
    if (val && val.length > 0) {
      lines.push(`I${idx + 1} = ${val}`);
    }
  }
  return peerBlock(lines, opts, allowed);
}

function peerBlock(lines: string[], opts: AmneziawgClientConfigOpts, allowed: string): string {
  lines.push('');
  lines.push('[Peer]');
  lines.push(`PublicKey = ${opts.serverPublicKey}`);
  lines.push(`AllowedIPs = ${allowed}`);
  lines.push(`Endpoint = ${opts.host}:${opts.port}`);
  lines.push(`PersistentKeepalive = ${opts.persistentKeepalive ?? 25}`);

  return lines.join('\n') + '\n';
}
