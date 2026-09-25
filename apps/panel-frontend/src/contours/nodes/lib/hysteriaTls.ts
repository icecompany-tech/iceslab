import type { Node, NodeCore } from '@/lib/domain/nodes';
import { coreEngine } from '@/contours/nodes/lib/coreRemove';

/**
 * Какой сертификат отдаёт нативная hysteria ноды и тот ли это, что выпустила
 * панель (E30a, 7fd101a).
 *
 * Два источника, и ни один не заменяет другой:
 *   намерение  `node.hysteriaTls`: пара, которую панель выпустила для ноды,
 *              адресованной по IP; null у ноды с FQDN (ACME) или до первого
 *              пуша; undefined у сервера старше поля;
 *   факт       `cores[].tls` у строки hysteria: что агент реально отдаёт;
 *              undefined у агента старше поля, это «не сообщил», а не «нет».
 *
 *   acme        ACME на адресе ноды, отпечатка нет;
 *   self-signed самоподписанный; `match` true/false только когда отпечатки
 *               есть с обеих сторон, иначе null: сравнивать нечего;
 *   unreported  панель выпустила пару, агент о сертификате не сказал;
 *   null        сказать нечего: ни намерения, ни факта.
 */
export type HysteriaTlsFacts =
  | { kind: 'acme'; host: string }
  | { kind: 'self-signed'; fingerprint: string | null; match: boolean | null; notAfter: string | null }
  | { kind: 'unreported' };

/** Строка нативной hysteria (у sing-box hysteria свой сертификат). */
export function isNativeHysteria(core: Pick<NodeCore, 'name' | 'engine'>): boolean {
  return core.name === 'hysteria' && coreEngine(core) === 'hysteria';
}

/** Первые 8 байт sha256 как ab:cd:…; кривое значение не отпечаток. */
export function shortFingerprint(sha256: string | undefined | null): string | null {
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
  return (sha256.toLowerCase().slice(0, 16).match(/../g) ?? []).join(':');
}

/** Хост из адреса ноды `host:port` (IPv6 в скобках). */
export function hostOfAddress(address: string): string {
  const a = address.trim();
  if (a.startsWith('[')) return a.slice(1, a.indexOf(']') > 0 ? a.indexOf(']') : undefined);
  const i = a.lastIndexOf(':');
  return i > 0 ? a.slice(0, i) : a;
}

export function hysteriaTlsFacts(
  node: Pick<Node, 'hysteriaTls' | 'address'>,
  core: Pick<NodeCore, 'name' | 'engine' | 'tls'>,
): HysteriaTlsFacts | null {
  if (!isNativeHysteria(core)) return null;
  const intent = node.hysteriaTls;
  const tls = core.tls;
  if (tls && typeof tls === 'object') {
    if (tls.source === 'acme') return { kind: 'acme', host: hostOfAddress(node.address) };
    if (tls.source === 'self-signed') {
      const served = typeof tls.certSha256 === 'string' ? tls.certSha256.toLowerCase() : null;
      const minted = intent?.certSha256?.toLowerCase() ?? null;
      return {
        kind: 'self-signed',
        fingerprint: shortFingerprint(served),
        match: served && minted ? served === minted : null,
        notAfter: typeof tls.notAfter === 'string' && tls.notAfter ? tls.notAfter : null,
      };
    }
  }
  // Факта нет: говорить есть о чём, только если панель пару выпустила.
  return intent ? { kind: 'unreported' } : null;
}

/** Ротация доступна, только когда у ноды есть выпущенная панелью пара. */
export function canRotateHysteriaTls(node: Pick<Node, 'hysteriaTls'>): boolean {
  return Boolean(node.hysteriaTls && node.hysteriaTls.certSha256);
}

/** 409 HYSTERIA_TLS_NOT_SELF_SIGNED: у ноды FQDN, сертификат ACME. Вход
 *  проверяется первым; null значит «отказ не этот». */
export function hysteriaTlsRefusal(err: unknown): { nodeName: string | null; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 409 || !res.data || typeof res.data !== 'object') return null;
  const d = res.data as { error?: unknown; nodeName?: unknown; message?: unknown };
  if (d.error !== 'HYSTERIA_TLS_NOT_SELF_SIGNED') return null;
  return {
    nodeName: typeof d.nodeName === 'string' ? d.nodeName : null,
    message: typeof d.message === 'string' ? d.message : '',
  };
}
