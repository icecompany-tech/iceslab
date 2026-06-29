/**
 * TUIC v5 share-link builder (sing-box engine).
 *
 * Format (the de-facto v5 link consumed by sing-box / NekoBox / mihomo):
 *
 *   tuic://<uuid>:<password>@<host>:<port>?sni=<sni>&congestion_control=<cc>
 *        &alpn=h3&udp_relay_mode=native&allow_insecure=1#<remark>
 *
 * The node serves a self-signed TLS cert in the alpha, so `allow_insecure=1`
 * is emitted by default; the client must still send the matching SNI.
 */
export interface TuicUriOpts {
  uuid: string;
  password: string;
  host: string;
  port: number;
  /** TLS SNI (server_name the cert is issued for). */
  serverName?: string;
  /** Congestion controller: bbr (default) | cubic | new_reno. */
  congestionControl?: string;
  /** Fragment / remark shown in the client. */
  name?: string;
  /** Skip cert verification (self-signed). Default true for the alpha. */
  allowInsecure?: boolean;
}

export function buildTuicUri(opts: TuicUriOpts): string {
  const params = new URLSearchParams();
  if (opts.serverName) params.set('sni', opts.serverName);
  params.set('congestion_control', opts.congestionControl || 'bbr');
  params.set('alpn', 'h3');
  params.set('udp_relay_mode', 'native');
  if (opts.allowInsecure ?? true) params.set('allow_insecure', '1');

  const auth = `${encodeURIComponent(opts.uuid)}:${encodeURIComponent(opts.password)}`;
  const frag = opts.name ? `#${encodeURIComponent(opts.name)}` : '';
  return `tuic://${auth}@${opts.host}:${opts.port}?${params.toString()}${frag}`;
}
