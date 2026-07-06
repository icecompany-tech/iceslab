/**
 * Trojan + REALITY URI builder. Slice 24c part 3.
 *
 * Wire format (consumed by v2rayN, NekoBox, Hiddify in Xray mode):
 *   trojan://<password>@<host>:<port>?<query>#<fragment>
 *
 * Differences vs VLESS+REALITY (see uri.ts):
 *   - Scheme is `trojan://` not `vless://`
 *   - Auth is a password (we reuse user.xrayUuid as the password, UUIDs
 *     have plenty of entropy and admins are already managing them)
 *   - No `flow=` param: Trojan doesn't pair with Vision (xtls-rprx-vision
 *     is a VLESS-only inner protocol)
 *   - No `encryption=none`: Trojan defines no payload encryption beyond TLS
 *
 * Same REALITY private/public key pair drives both inbounds, clients only
 * see the difference at the URI scheme level.
 */

export type TrojanNetwork = 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';

export interface TrojanRealityUriOpts {
  password: string;
  host: string;
  port: number;
  publicKey: string;
  shortId: string;
  sni: string;
  fingerprint?: string;
  name: string;
  network?: TrojanNetwork;
  path?: string;
  hostHeader?: string;
  serviceName?: string;
  /** Slice 30.1: per-host overrides. See VlessRealityUriOpts for semantics. */
  alpn?: string[];
  allowInsecure?: boolean;
  securityLayer?: 'default' | 'tls' | 'none';
}

export function buildTrojanRealityUri(opts: TrojanRealityUriOpts): string {
  const network: TrojanNetwork = opts.network ?? 'raw';

  let security = 'reality';
  if (opts.securityLayer === 'tls') security = 'tls';
  else if (opts.securityLayer === 'none') security = 'none';

  const params = new URLSearchParams({
    type: network,
    security,
  });

  // REALITY material only for the reality layer; SNI + fp for any TLS-like
  // layer but not plain 'none' (CDN-terminated TLS). Insertion order preserves
  // the reality query string exactly.
  if (security === 'reality') {
    params.set('pbk', opts.publicKey);
    params.set('sid', opts.shortId);
  }
  if (security !== 'none') {
    params.set('sni', opts.sni);
    params.set('fp', opts.fingerprint ?? 'chrome');
  }

  if (opts.alpn && opts.alpn.length > 0) {
    params.set('alpn', opts.alpn.join(','));
  }
  if (opts.allowInsecure) {
    params.set('allowInsecure', '1');
  }

  if (network === 'ws' || network === 'xhttp' || network === 'httpupgrade') {
    if (opts.path) params.set('path', opts.path);
    if (opts.hostHeader) params.set('host', opts.hostHeader);
  }
  if (network === 'grpc' && opts.serviceName) {
    params.set('serviceName', opts.serviceName);
  }
  if (network === 'kcp') {
    params.set('headerType', 'none');
  }

  // Password is the userinfo segment, must be URL-encoded for safety.
  // UUIDs (which we use as passwords) don't actually need encoding, but
  // future arbitrary passwords might.
  return `trojan://${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}?${params.toString()}#${encodeURIComponent(opts.name)}`;
}
