import type { NodesListResponse } from '@/lib/domain/nodes';

/**
 * Необязательные ключи DTO ноды, про которые экран спрашивает. Состав `fields`
 * решает сервер (NODE_DTO_FIELDS в nodes.mapper.ts); `awgProtocol` он сегодня
 * не рендерит вовсе, и мастер честно остаётся без выбора поколения AWG.
 */
export type OptionalNodeField = 'awgProtocol' | 'coreVersions' | 'intendedEngines' | 'cascadeNeedsEngines' | 'geo';

/**
 * Отдаёт ли сервер ключ `field` у нод (E29, стенд 24.09).
 *
 * Первым спрашивается сам сервер: конверт GET /api/nodes несёт `fields`, имена
 * необязательных ключей, которые он рендерит. Раньше знание выводилось только
 * из стоящих нод, и на пустом парке (владелец удалил все ноды) мастер показал
 * старую форму без чипов, версий и AWG: отсутствие нод прочиталось как «сервер
 * поля не знает». Отсутствие данных не факт «нет».
 *
 * Вывод по нодам остаётся для сервера старше `fields`: ключ, который он отдаёт,
 * есть у каждой ноды, так что хватает одной. Кривой `fields` (не список строк)
 * не факт и читается как его отсутствие.
 */
export function nodeFieldKnown(
  list: Pick<NodesListResponse, 'nodes'> & { fields?: unknown } | undefined,
  field: OptionalNodeField,
): boolean {
  return listFieldKnown(list?.fields, list?.nodes, field);
}

/**
 * То же правило для любого списка с конвертом `fields` (у каскадов с Ф9.3,
 * CASCADE_DTO_FIELDS): сперва слово сервера, по элементам только у сервера
 * старше поля. Ответа ещё нет: не знает.
 */
export function listFieldKnown(
  fields: unknown,
  items: readonly object[] | undefined,
  field: string,
  /** Имя в `fields`, когда ключ вложенный: `directions[].linkProtocol` у
   *  ключа `linkProtocol` направления. По умолчанию то же, что `field`. */
  listedAs: string = field,
): boolean {
  if (Array.isArray(fields) && fields.every((f) => typeof f === 'string') && fields.includes(listedAs)) return true;
  return (items ?? []).some((it) => (it as Record<string, unknown>)[field] !== undefined);
}
