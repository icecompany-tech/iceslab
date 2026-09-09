import { isIP } from 'node:net';

/**
 * True only for IPv4/IPv6 addresses safe to use as a blacklist key: filters out
 * loopback, RFC1918 private, link-local, CGNAT, and unspecified addresses.
 *
 * Why it matters: the honeypot/leak tripwires blacklist the source IP for
 * HONEYPOT_BLACKLIST_TTL_SEC (default 1h). If `request.ip` is attacker-
 * controlled (a misconfigured TRUST_PROXY_HOPS lets a client forge
 * X-Forwarded-For with a private OR a victim's public IP), blacklisting it
 * would DoS whoever really sits behind that address. Refusing to blacklist a
 * non-routable IP closes the private/loopback half; the caller should still
 * combine this with a correct proxy-hop count so a forged *public* IP can't be
 * used to blacklist a third party.
 */
export function isPublicRoutableIp(ip: string): boolean {
  if (!ip) return false;
  const v = isIP(ip);
  if (v === 0) return false;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4), recurse into the v4 side so the
  // private-range guards below catch ::ffff:10.0.0.1 / ::ffff:127.0.0.1.
  // Otherwise an attacker spoofing X-Forwarded-For: ::ffff:10.0.0.1 would pass
  // isIP===6 and the v6 branch's loose-prefix checks miss it.
  if (v === 6 && /^::ffff:/i.test(ip)) {
    return isPublicRoutableIp(ip.replace(/^::ffff:/i, ''));
  }
  if (v === 4) {
    const parts = ip.split('.').map((s) => parseInt(s, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
    // 100.64.0.0/10: CGNAT. Not strictly "private" but operators sharing a
    // carrier-NAT range shouldn't be blacklisted by us either.
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  // IPv6 (non-mapped).
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return false;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  // Multicast (ff00::/8), documentation (2001:db8::/32).
  if (lower.startsWith('ff')) return false;
  if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return false;
  return true;
}
