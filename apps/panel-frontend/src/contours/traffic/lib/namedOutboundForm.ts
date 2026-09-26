import type {
  CreateNamedOutboundInput,
  NamedOutbound,
  NamedOutboundType,
  OutboundSecurity,
  UpdateNamedOutboundInput,
} from '@/lib/domain/namedOutbounds';

/**
 * Форма именованного выхода (фаза 10): значения формы, тело POST и PUT, свои
 * проверки до кнопки. Правила те же, что у схемы сервера
 * (named-outbounds.schemas.ts); сервер всё равно решает, а его отказ по полю
 * встаёт под то же поле (namedOutboundRefusal).
 */
export interface OutboundFormValues {
  name: string;
  type: NamedOutboundType;
  /** '' = без страны. */
  countryCode: string;
  server: string;
  port: number | '';
  // vless
  uuid: string;
  /** xtls-rprx-vision; только при tls или reality. */
  vision: boolean;
  security: OutboundSecurity;
  sni: string;
  /** '' = не задан. */
  fingerprint: string;
  /** Через запятую, как вводят. */
  alpn: string;
  realityPublicKey: string;
  realityShortId: string;
  // socks
  username: string;
  password: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function outboundFormValues(o: NamedOutbound | null): OutboundFormValues {
  const c = o?.config ?? {};
  const security = c.security === 'tls' || c.security === 'reality' ? c.security : 'none';
  return {
    name: o?.name ?? '',
    type: o?.type ?? 'vless',
    countryCode: o?.countryCode ?? '',
    server: str(c.server),
    port: typeof c.port === 'number' ? c.port : '',
    uuid: str(c.uuid),
    vision: c.flow === 'xtls-rprx-vision',
    security,
    sni: str(c.sni),
    fingerprint: str(c.fingerprint),
    alpn: Array.isArray(c.alpn) ? c.alpn.filter((a): a is string => typeof a === 'string').join(', ') : '',
    realityPublicKey: str(c.realityPublicKey),
    realityShortId: str(c.realityShortId),
    username: str(c.username),
    password: str(c.password),
  };
}

/**
 * `config` по типу, ровно с теми ключами, что тип и безопасность называют:
 * поле, которого цепь не рисует, сервер отвергает, а не несёт.
 */
export function outboundConfig(v: OutboundFormValues): Record<string, unknown> {
  if (v.type === 'vless') {
    const secured = v.security !== 'none';
    const alpn = v.alpn
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    return {
      server: v.server.trim(),
      port: v.port === '' ? 0 : v.port,
      uuid: v.uuid.trim(),
      flow: secured && v.vision ? 'xtls-rprx-vision' : null,
      security: v.security,
      ...(secured && v.sni.trim() ? { sni: v.sni.trim() } : {}),
      ...(secured && v.fingerprint ? { fingerprint: v.fingerprint } : {}),
      ...(secured && alpn.length > 0 ? { alpn } : {}),
      // shortId может быть пустым, и пустой уходит: REALITY его требует.
      ...(v.security === 'reality'
        ? { realityPublicKey: v.realityPublicKey.trim(), realityShortId: v.realityShortId.trim().toLowerCase() }
        : {}),
    };
  }
  if (v.type === 'socks') {
    const user = v.username.trim();
    return {
      server: v.server.trim(),
      port: v.port === '' ? 0 : v.port,
      ...(user || v.password ? { username: user, password: v.password } : {}),
    };
  }
  return {};
}

export function outboundCreateBody(v: OutboundFormValues): CreateNamedOutboundInput {
  return {
    name: v.name.trim(),
    type: v.type,
    ...(v.countryCode ? { countryCode: v.countryCode } : {}),
    config: outboundConfig(v),
  };
}

/**
 * PUT: только изменённое. Конфиг сравнивается в той же форме, в какой уходит
 * (outboundConfig от сохранённого против outboundConfig от правки), поэтому
 * порядок ключей и лишнее в хранимом не делают правку из ничего. Смена типа
 * всегда идёт с конфигом: сервер без него отказывает.
 */
export function outboundUpdateBody(stored: NamedOutbound, v: OutboundFormValues): UpdateNamedOutboundInput {
  const before = outboundFormValues(stored);
  const body: UpdateNamedOutboundInput = {};
  if (v.name.trim() !== stored.name) body.name = v.name.trim();
  if (v.countryCode !== before.countryCode) body.countryCode = v.countryCode || null;
  const typeChanged = v.type !== stored.type;
  if (typeChanged) body.type = v.type;
  const next = outboundConfig(v);
  if (typeChanged || JSON.stringify(next) !== JSON.stringify(outboundConfig(before))) body.config = next;
  return body;
}

/**
 * Что форма видит неверным до кнопки: поле и ключ слов. Пусто: можно слать.
 * Только то, что схема сервера проверяет так же; остальное скажет он.
 */
export type OutboundProblem =
  | 'name'
  | 'server'
  | 'port'
  | 'uuid'
  | 'realityPublicKey'
  | 'realityShortId'
  | 'sni'
  | 'socksPair';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function outboundProblems(v: OutboundFormValues): Partial<Record<keyof OutboundFormValues, OutboundProblem>> {
  const out: Partial<Record<keyof OutboundFormValues, OutboundProblem>> = {};
  const name = v.name.trim();
  if (!name || name.length > 64 || !NAME_RE.test(name)) out.name = 'name';
  if (v.type !== 'vless' && v.type !== 'socks') return out;
  if (!/^[A-Za-z0-9.:-]{1,253}$/.test(v.server.trim())) out.server = 'server';
  if (v.port === '' || !Number.isInteger(v.port) || v.port < 1 || v.port > 65535) out.port = 'port';
  if (v.type === 'vless') {
    if (!UUID_RE.test(v.uuid.trim())) out.uuid = 'uuid';
    if (v.security === 'reality') {
      if (!/^[A-Za-z0-9_-]{43}$/.test(v.realityPublicKey.trim())) out.realityPublicKey = 'realityPublicKey';
      if (!/^([0-9a-f]{2}){0,8}$/.test(v.realityShortId.trim().toLowerCase())) out.realityShortId = 'realityShortId';
      if (!v.sni.trim()) out.sni = 'sni';
    }
  } else if (Boolean(v.username.trim()) !== Boolean(v.password)) {
    out.password = 'socksPair';
  }
  return out;
}
