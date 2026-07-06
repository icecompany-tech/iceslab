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

export function buildAmneziawgClientConfig(opts: AmneziawgClientConfigOpts): string {
  const allowed = (opts.clientAllowedIps?.length ? opts.clientAllowedIps : ['0.0.0.0/0', '::/0']).join(', ');
  const lines: string[] = [];

  lines.push('[Interface]');
  lines.push(`PrivateKey = ${opts.privateKey}`);
  lines.push(`Address = ${opts.allowedIp}`);
  if (opts.dns?.length) {
    lines.push(`DNS = ${opts.dns.join(', ')}`);
  }
  lines.push(`Jc = ${opts.jc}`);
  lines.push(`Jmin = ${opts.jmin}`);
  lines.push(`Jmax = ${opts.jmax}`);
  lines.push(`S1 = ${opts.s1}`);
  lines.push(`S2 = ${opts.s2}`);
  lines.push(`S3 = ${opts.s3}`);
  lines.push(`S4 = ${opts.s4}`);
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
  lines.push('');
  lines.push('[Peer]');
  lines.push(`PublicKey = ${opts.serverPublicKey}`);
  lines.push(`AllowedIPs = ${allowed}`);
  lines.push(`Endpoint = ${opts.host}:${opts.port}`);
  lines.push(`PersistentKeepalive = ${opts.persistentKeepalive ?? 25}`);

  return lines.join('\n') + '\n';
}
