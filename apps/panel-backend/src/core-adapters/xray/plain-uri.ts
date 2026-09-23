/**
 * Share links for the SOCKS5 and HTTP doors on the xray process (the Telegram
 * entries, 2026-09-23). Login = username, password = xrayUuid, no TLS.
 */

export interface PlainProxyUriOpts {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Display name after `#`. */
  name: string;
}

/**
 * `socks://base64(user:pass)@host:port#name`, the form the v2rayN family
 * imports: credentials base64-encoded as one `user:pass` string (padding
 * kept) so that neither half needs escaping inside the userinfo.
 */
export function buildSocksUri(opts: PlainProxyUriOpts): string {
  const auth = Buffer.from(`${opts.username}:${opts.password}`, 'utf8').toString('base64');
  return `socks://${auth}@${opts.host}:${opts.port}#${encodeURIComponent(opts.name)}`;
}

/** `http://user:pass@host:port#name`, each half percent-encoded. */
export function buildHttpProxyUri(opts: PlainProxyUriOpts): string {
  const user = encodeURIComponent(opts.username);
  const pass = encodeURIComponent(opts.password);
  return `http://${user}:${pass}@${opts.host}:${opts.port}#${encodeURIComponent(opts.name)}`;
}

/**
 * `tg://socks?server=&port=&user=&pass=`: opens Telegram's "add proxy" dialog.
 *
 * No `#fragment`, for the reason recorded at buildMtprotoUri: Telegram answers
 * a fragment on its proxy links with "Invalid proxy link" (iOS, 2026-05-20).
 * HTTP has no such link in any Telegram client, so there is no tg:// for it.
 */
export function buildTelegramSocksUri(opts: Omit<PlainProxyUriOpts, 'name'>): string {
  const params = new URLSearchParams({
    server: opts.host,
    port: String(opts.port),
    user: opts.username,
    pass: opts.password,
  });
  return `tg://socks?${params.toString()}`;
}
