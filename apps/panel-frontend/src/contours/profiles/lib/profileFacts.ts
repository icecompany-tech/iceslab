import type { ProtocolName } from '@iceslab/shared';

/**
 * The three facts a profile card shows under its name (A-287): the settings an
 * operator would ask about before deploying it. Anything else lives in the
 * editor.
 *
 * Every fact reads a key the form looks after (PROFILE_CONFIG_KEYS[p].form in
 * shared), by its path inside the config: the card used to read `jc`, `mtu`,
 * `sni`, `alpn`, `port` and others that no config holds, so most facts were
 * «-» on every profile. A fact with no key in the schema is not shown at all.
 * profileFacts.test.ts holds each read key to the shared list.
 *
 * «-» is left only for a key the profile does not have set.
 */
export interface ProfileFact {
  label: string;
  value: string;
  /** Top-level config keys the fact read: what the test holds to shared. */
  keys: string[];
}

type Cfg = Record<string, unknown>;
interface Spec {
  label: string;
  read: (cfg: Cfg) => { keys: string[]; value: string | null };
}

function at(cfg: Cfg, path: readonly string[]): unknown {
  let v: unknown = cfg;
  for (const k of path) {
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, k)) return undefined;
    v = (v as Cfg)[k];
  }
  return v;
}

/** A string, a number, or the first non-empty string of a list. */
function text(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return v.map(text).find((x) => x !== null) ?? null;
  return null;
}

const key = (label: string, ...path: [string, ...string[]]): Spec => ({
  label,
  read: (cfg) => ({ keys: [path[0]], value: text(at(cfg, path)) }),
});

/** The host of a URL, or the text as it is when it is not one. */
function hostOf(v: string): string {
  try {
    return new URL(v).host || v;
  } catch {
    return v;
  }
}

const FACTS: Record<ProtocolName, Spec[]> = {
  amneziawg: [key('subnet', 'subnet'), key('jc', 'obfuscation', 'jc'), key('s1', 'obfuscation', 's1')],
  hysteria: [
    // The password itself never reaches the card: only that there is one.
    {
      label: 'obfs',
      read: (cfg) => ({ keys: ['obfsPassword'], value: text(cfg.obfsPassword) ? 'salamander' : null }),
    },
    {
      label: 'masquerade',
      read: (cfg) => {
        const url = text(cfg.masqueradeUrl);
        return { keys: ['masqueradeUrl'], value: url ? hostOf(url) : null };
      },
    },
    {
      label: 'hopping',
      read: (cfg) => {
        const start = text(cfg.portHoppingStart);
        const end = text(cfg.portHoppingEnd);
        return {
          keys: ['portHoppingStart', 'portHoppingEnd'],
          value: start && end ? `${start}-${end}` : (start ?? end),
        };
      },
    },
  ],
  xray: [
    key('security', 'security'),
    key('transport', 'network'),
    {
      // The name the client puts in its handshake: REALITY's server name, or
      // the TLS one.
      label: 'sni',
      read: (cfg) =>
        cfg.security === 'tls'
          ? { keys: ['tlsServerName'], value: text(cfg.tlsServerName) }
          : { keys: ['realityServerNames'], value: text(cfg.realityServerNames) },
    },
  ],
  naive: [key('host', 'hostname'), key('email', 'tlsEmail'), key('root', 'masqueradeRoot')],
  shadowsocks: [key('method', 'method')],
  mtproto: [key('domain', 'domain')],
  mieru: [key('mtu', 'mtu')],
  tuic: [key('sni', 'serverName'), key('cc', 'congestionControl')],
  anytls: [key('sni', 'serverName')],
  shadowtls: [key('handshake', 'handshake'), key('ss', 'ssMethod')],
};

/** SOCKS5 and HTTP on xray: what tells them apart is what they speak. */
const PLAIN: Spec[] = [key('protocol', 'subprotocol'), key('security', 'security'), key('transport', 'network')];

export function profileFacts(protocol: ProtocolName, config: unknown, plain: boolean): ProfileFact[] {
  const cfg = (config && typeof config === 'object' ? config : {}) as Cfg;
  const specs = plain ? PLAIN : (FACTS[protocol] ?? []);
  return specs.map((s) => {
    const r = s.read(cfg);
    return { label: s.label, value: r.value ?? '-', keys: r.keys };
  });
}
