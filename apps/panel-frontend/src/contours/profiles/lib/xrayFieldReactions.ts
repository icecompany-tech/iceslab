import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import { FLOW_COMPATIBLE_TRANSPORTS } from '@/contours/profiles/lib/xrayTransports';

type XrayFields = Pick<FormValues, 'xrayNetwork' | 'xrayServiceName' | 'xrayFlow' | 'xraySubprotocol' | 'xraySecurity'>;

/**
 * Что форма профиля правит сама, когда оператор меняет транспорт или
 * подпротокол xray. Раньше это жило в трёх useEffect с подавленными
 * зависимостями; теперь одна чистая функция, и хук зовёт её из
 * onValuesChange формы, то есть на ЛЮБУЮ смену значения: правку поля,
 * рецепт, засев.
 *
 * Реакция только на смену своего поля, как у прежних эффектов:
 *   транспорт стал grpc, а serviceName пуст  -> GunService (поле
 *     обязательное, иначе форма не сохраняется с непонятным «заполните поле»);
 *     оператор, очистивший serviceName потом, получает пустое поле: смены
 *     транспорта не было, реакции нет;
 *   транспорт, на котором Vision не работает -> flow снимается;
 *   подпротокол стал vmess при REALITY        -> security none (ссылка vmess
 *     REALITY не несёт).
 *
 * `previous` null это «всё сменилось»: так форма ведёт себя на засеве, как
 * прежние эффекты на первом рендере.
 */
export function xrayFieldReactions(values: XrayFields, previous: XrayFields | null): Partial<XrayFields> | null {
  const patch: Partial<XrayFields> = {};
  if (!previous || values.xrayNetwork !== previous.xrayNetwork) {
    if (values.xrayNetwork === 'grpc' && !values.xrayServiceName) patch.xrayServiceName = 'GunService';
    if (!FLOW_COMPATIBLE_TRANSPORTS.includes(values.xrayNetwork) && values.xrayFlow) patch.xrayFlow = '';
  }
  if (!previous || values.xraySubprotocol !== previous.xraySubprotocol) {
    if (values.xraySubprotocol === 'vmess' && values.xraySecurity === 'reality') patch.xraySecurity = 'none';
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Значения формы, в которых реакции уже применены (засев). */
export function settleXrayFields<V extends XrayFields>(values: V): V {
  const patch = xrayFieldReactions(values, null);
  return patch ? { ...values, ...patch } : values;
}
