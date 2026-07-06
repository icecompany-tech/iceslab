/**
 * Guard for operator-configured recipe-source URLs.
 *
 * A recipe source is a URL the admin adds; the backend then fetches it. The
 * admin already has shell on the box, so this is defense-in-depth rather than
 * a hard trust boundary, but we still refuse the obvious SSRF footguns:
 * non-https schemes and hosts that are loopback / link-local / private / cloud
 * metadata literals. This does NOT resolve DNS, so a public name pointing at a
 * private IP is not caught; that is an accepted limitation for an admin-only,
 * admin-trusted setting in v1.
 */

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^127\./, // IPv4 loopback
  /^10\./, // IPv4 private
  /^192\.168\./, // IPv4 private
  /^172\.(1[6-9]|2\d|3[01])\./, // IPv4 private 172.16-31
  /^169\.254\./, // IPv4 link-local + cloud metadata (169.254.169.254)
  /^0\./, // this-network
];

function isBlockedHost(host: string): boolean {
  // URL.hostname keeps the [] around an IPv6 literal, so strip them and the
  // bare-address checks below match (e.g. "[::1]" -> "::1").
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    h === '0.0.0.0'
  ) {
    return true;
  }
  // IPv6 literals only (they contain a colon; a domain like "fc-cdn.com"
  // must not be blocked): loopback ::1, unique-local fc00::/7, link-local
  // fe80::/10.
  if (h.includes(':') && (h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h))) {
    return true;
  }
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(h));
}

/**
 * Validate a recipe-source URL and return the parsed URL. Throws with a
 * human-readable message the routes surface as a 400. https-only; loopback /
 * private / metadata hosts are rejected.
 */
export function assertFetchableUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Source URL is not a valid URL');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Source URL must use https');
  }
  if (isBlockedHost(u.hostname)) {
    throw new Error('Source URL host is not allowed (loopback / private / metadata)');
  }
  return u;
}
