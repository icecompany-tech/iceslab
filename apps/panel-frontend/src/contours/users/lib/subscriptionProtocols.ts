import { PROTOCOL_NAMES, type ProtocolName } from '@iceslab/shared';

/**
 * Ссылка подписки на один протокол (BACK 55dacc5, `?protocols=`): боту
 * оператора нужна ссылка на протокол, а не вся подписка.
 *
 * Имена панели (PROTOCOL_NAMES), vless это xray. Строка каскада принадлежит
 * протоколу ВХОДА, то есть протоколу эндпоинта, который её несёт, поэтому
 * список берётся прямо из эндпоинтов пользователя.
 */

/** Протоколы эндпоинтов пользователя, без повторов, в порядке панели. */
export function userProtocols(endpoints: readonly { protocol: string }[] | undefined): ProtocolName[] {
  const have = new Set((endpoints ?? []).map((e) => e.protocol));
  return PROTOCOL_NAMES.filter((p) => have.has(p));
}

/**
 * `url` с параметром `protocols`, или без него для пустого списка. Правило то
 * же, что у сервера (subscription.protocols.ts withProtocols): прочие
 * параметры на местах, `protocols` первым, фрагмент в конце, так один выбор
 * всегда пишется одной ссылкой.
 */
export function withProtocols(url: string, list: readonly string[]): string {
  const hash = url.indexOf('#');
  const frag = hash < 0 ? '' : url.slice(hash);
  const rest = hash < 0 ? url : url.slice(0, hash);
  const q = rest.indexOf('?');
  const base = q < 0 ? rest : rest.slice(0, q);
  const params = (q < 0 ? '' : rest.slice(q + 1)).split('&').filter((p) => p !== '' && !p.startsWith('protocols='));
  if (list.length > 0) params.unshift(`protocols=${list.join(',')}`);
  return base + (params.length > 0 ? `?${params.join('&')}` : '') + frag;
}
