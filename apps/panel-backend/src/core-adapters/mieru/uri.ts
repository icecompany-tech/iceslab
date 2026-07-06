/**
 * Mieru profile builder. Slice 40.
 *
 * Mieru clients (mieru-cli, GoMieru-Android, mieru-iOS) consume a JSON
 * profile, not a URI. There's no upstream-blessed `mieru://` scheme as of
 * 2026-05; community proposals exist but aren't standardised.
 *
 * What we ship:
 *   1. `buildMieruProfileJson(...)`: emits the JSON that mieru clients
 *      import via "Add profile from file/clipboard". Subscription endpoint
 *      `/sub/<token>?format=mieru-json` returns this.
 *   2. `buildMieruUri(...)`: pseudo-URI for the plain-format subscription
 *      list. Form: `mieru://<password>@<host>:<port>?mtu=1400#<name>`. Not
 *      a real protocol scheme but matches our other URI shapes for client
 *      tooling that can fall back to "we don't know this URI but show it
 *      in the proxy list".
 */

export interface MieruProfileOpts {
  profileName: string;
  username: string;
  password: string;
  host: string;
  port: number;
  /** UDP also opened on the same port number (server config decides). */
  protocols?: ('TCP' | 'UDP')[];
  mtu?: number;
}

export interface MieruProfileJson {
  profiles: [
    {
      profileName: string;
      user: { name: string; password: string };
      servers: [
        {
          ipAddress: string;
          portBindings: { port: number; protocol: 'TCP' | 'UDP' }[];
        },
      ];
      mtu: number;
    },
  ];
}

export function buildMieruProfileJson(opts: MieruProfileOpts): MieruProfileJson {
  const protocols = opts.protocols ?? ['TCP', 'UDP'];
  return {
    profiles: [
      {
        profileName: opts.profileName,
        user: { name: opts.username, password: opts.password },
        servers: [
          {
            ipAddress: opts.host,
            portBindings: protocols.map((protocol) => ({
              port: opts.port,
              protocol,
            })),
          },
        ],
        mtu: opts.mtu ?? 1400,
      },
    ],
  };
}

export interface MieruUriOpts {
  username: string;
  password: string;
  host: string;
  port: number;
  mtu?: number;
  name: string;
}

/**
 * Pseudo-URI for plain-list and JSON subscription formats. Mieru-aware
 * clients won't auto-import this, they want the JSON profile, but it
 * keeps our subscription emitter shape uniform.
 */
export function buildMieruUri(opts: MieruUriOpts): string {
  const params = new URLSearchParams();
  if (opts.mtu) params.set('mtu', String(opts.mtu));
  params.set('user', opts.username);
  const query = params.toString();
  const userinfo = encodeURIComponent(opts.password);
  return `mieru://${userinfo}@${opts.host}:${opts.port}${query ? `?${query}` : ''}#${encodeURIComponent(opts.name)}`;
}
