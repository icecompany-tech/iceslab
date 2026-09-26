import { api } from '@/lib/net/client';

/**
 * Именованные выходы (фаза 10, BACK a045f29): чужие vless и socks серверы,
 * которые оператор называет по имени, чтобы направление каскада могло на них
 * стоять. Контракт лежит у сервера (named-outbounds.schemas.ts, .mapper.ts), в
 * shared его нет, поэтому форма здесь зеркалит его словами.
 */
export const NAMED_OUTBOUND_TYPES = ['vless', 'socks', 'freedom', 'blackhole'] as const;
export type NamedOutboundType = (typeof NAMED_OUTBOUND_TYPES)[number];

/** Что форма создаёт (ARCH 26.09): freedom и blackhole это direct и block
 *  политики ноды, они видны в списке, только если пришли импортом. */
export const CREATABLE_OUTBOUND_TYPES: readonly NamedOutboundType[] = ['vless', 'socks'];

/** uTLS-отпечатки, которые берёт движок цепи (sing-box 1.13). */
export const OUTBOUND_FINGERPRINTS = [
  'chrome',
  'firefox',
  'edge',
  'safari',
  '360',
  'qq',
  'ios',
  'android',
  'random',
  'randomized',
] as const;
export type OutboundFingerprint = (typeof OUTBOUND_FINGERPRINTS)[number];

export type OutboundSecurity = 'none' | 'tls' | 'reality';

export interface VlessOutboundConfig {
  server: string;
  port: number;
  uuid: string;
  flow: 'xtls-rprx-vision' | null;
  security: OutboundSecurity;
  sni?: string;
  fingerprint?: OutboundFingerprint;
  alpn?: string[];
  realityPublicKey?: string;
  realityShortId?: string;
}

export interface SocksOutboundConfig {
  server: string;
  port: number;
  username?: string;
  password?: string;
}

export interface NamedOutboundUse {
  cascadeId: string;
  cascadeName: string;
  directionTag: number;
}

export interface NamedOutbound {
  id: string;
  name: string;
  type: NamedOutboundType;
  countryCode: string | null;
  /** По типу, с секретами (одна панель одного оператора, ARCH 26.09). */
  config: Record<string, unknown>;
  /** Направления, которые на нём стоят; непустой список отказывает удалению. */
  usedBy: NamedOutboundUse[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateNamedOutboundInput {
  name: string;
  type: NamedOutboundType;
  countryCode?: string | null;
  config: Record<string, unknown>;
}

/** Нет ключа: не трогать. `type` только вместе с `config`. */
export interface UpdateNamedOutboundInput {
  name?: string;
  type?: NamedOutboundType;
  countryCode?: string | null;
  config?: Record<string, unknown>;
}

export async function listNamedOutbounds(): Promise<{ outbounds: NamedOutbound[] }> {
  const { data } = await api.get<{ outbounds: NamedOutbound[] }>('/api/named-outbounds');
  return data;
}

export async function createNamedOutbound(input: CreateNamedOutboundInput): Promise<NamedOutbound> {
  const { data } = await api.post<NamedOutbound>('/api/named-outbounds', input);
  return data;
}

export async function updateNamedOutbound(id: string, input: UpdateNamedOutboundInput): Promise<NamedOutbound> {
  const { data } = await api.put<NamedOutbound>(`/api/named-outbounds/${id}`, input);
  return data;
}

export async function deleteNamedOutbound(id: string): Promise<void> {
  await api.delete(`/api/named-outbounds/${id}`);
}

/**
 * Отказ сервера по именованному выходу, или null для чужой ошибки.
 *
 *   400 VALIDATION (сервис) и VALIDATION_ERROR (схема): issues с путём; путь
 *       `config.<поле>` становится именем поля формы, `name` и прочее верхнего
 *       уровня остаётся как есть;
 *   409 NAMED_OUTBOUND_NAME_TAKEN { name };
 *   409 NAMED_OUTBOUND_IN_USE { usedBy[] } на удалении;
 *   409 NAMED_OUTBOUND_TYPE_NOT_FOR_DIRECTION { type, usedBy[] }.
 *
 * Вход проверяется первым: это разбор сетевой ошибки.
 */
export type NamedOutboundRefusal =
  | { code: 'VALIDATION'; issues: { field: string; message: string }[] }
  | { code: 'NAME_TAKEN'; name: string }
  | { code: 'IN_USE'; usedBy: NamedOutboundUse[] }
  | { code: 'TYPE_NOT_FOR_DIRECTION'; type: string; usedBy: NamedOutboundUse[] };

function uses(raw: unknown): NamedOutboundUse[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedOutboundUse[] = [];
  for (const u of raw) {
    if (!u || typeof u !== 'object') continue;
    const r = u as Record<string, unknown>;
    if (typeof r.cascadeId !== 'string' || typeof r.cascadeName !== 'string') continue;
    out.push({
      cascadeId: r.cascadeId,
      cascadeName: r.cascadeName,
      directionTag: typeof r.directionTag === 'number' ? r.directionTag : 0,
    });
  }
  return out;
}

export function namedOutboundRefusal(err: unknown): NamedOutboundRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as Record<string, unknown>;
  if (res.status === 400 && (d.error === 'VALIDATION' || d.error === 'VALIDATION_ERROR')) {
    if (!Array.isArray(d.issues)) return null;
    const issues: { field: string; message: string }[] = [];
    for (const i of d.issues) {
      if (!i || typeof i !== 'object') continue;
      const r = i as { path?: unknown; message?: unknown };
      if (!Array.isArray(r.path) || typeof r.message !== 'string') continue;
      const path = r.path.map(String);
      const field = path[0] === 'config' && path.length > 1 ? path[1] : (path[0] ?? '');
      issues.push({ field, message: r.message });
    }
    return { code: 'VALIDATION', issues };
  }
  if (res.status !== 409) return null;
  if (d.error === 'NAMED_OUTBOUND_NAME_TAKEN') {
    return { code: 'NAME_TAKEN', name: typeof d.name === 'string' ? d.name : '' };
  }
  if (d.error === 'NAMED_OUTBOUND_IN_USE') return { code: 'IN_USE', usedBy: uses(d.usedBy) };
  if (d.error === 'NAMED_OUTBOUND_TYPE_NOT_FOR_DIRECTION') {
    return { code: 'TYPE_NOT_FOR_DIRECTION', type: typeof d.type === 'string' ? d.type : '', usedBy: uses(d.usedBy) };
  }
  return null;
}
