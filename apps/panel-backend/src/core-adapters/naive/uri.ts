/**
 * Client URI builder for NaiveProxy.
 *
 * Wire format (per upstream Naive readme):
 *   naive+https://<user>:<password>@<host>:<port>?<query>#<fragment>
 *
 * Query params:
 *   padding=true   - pad HTTP/2 frames to mask packet-size fingerprint.
 *                    Always on for Iceslab, without padding the inbound
 *                    fingerprints differently from real Chromium.
 *
 * Fragment is the human-readable node label shown by the client.
 */

export interface NaiveUriOpts {
  /** Username matching the `basic_auth` line in the server Caddyfile. */
  username: string;
  /** User's `naivePassword` from the panel users table. */
  password: string;
  /** Public hostname the client connects to (no port). */
  host: string;
  /** Public TCP port the Caddy/naive inbound listens on. */
  port: number;
  /** URL fragment shown by the client (typically the node name). */
  name: string;
  /** Whether to enable HTTP/2 frame padding. Default true. */
  padding?: boolean;
}

export function buildNaiveUri(opts: NaiveUriOpts): string {
  const userinfo = `${encodeURIComponent(opts.username)}:${encodeURIComponent(opts.password)}`;
  const params = new URLSearchParams();
  if (opts.padding !== false) {
    params.set('padding', 'true');
  }
  const query = params.toString();
  const queryPart = query ? `?${query}` : '';
  return `naive+https://${userinfo}@${opts.host}:${opts.port}${queryPart}#${encodeURIComponent(opts.name)}`;
}
