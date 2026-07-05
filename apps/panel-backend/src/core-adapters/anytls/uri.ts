/**
 * AnyTLS share-link builder (sing-box engine).
 *
 * Format (the link consumed by sing-box / mihomo clients):
 *
 *   anytls://<password>@<host>:<port>?sni=<sni>&insecure=1#<remark>
 *
 * AnyTLS auth is password-only (no uuid). The node serves a self-signed TLS
 * cert in the alpha, so `insecure=1` is emitted by default; the client still
 * sends the matching SNI.
 */
export interface AnytlsUriOpts {
  password: string;
  host: string;
  port: number;
  /** TLS SNI (server_name the cert is issued for). */
  serverName?: string;
  /** Fragment / remark shown in the client. */
  name?: string;
  /** Skip cert verification (self-signed). Default true for the alpha. */
  allowInsecure?: boolean;
}

export function buildAnytlsUri(opts: AnytlsUriOpts): string {
  const params = new URLSearchParams();
  if (opts.serverName) params.set('sni', opts.serverName);
  if (opts.allowInsecure ?? true) params.set('insecure', '1');

  const auth = encodeURIComponent(opts.password);
  const frag = opts.name ? `#${encodeURIComponent(opts.name)}` : '';
  const q = params.toString();
  return `anytls://${auth}@${opts.host}:${opts.port}${q ? `?${q}` : ''}${frag}`;
}
