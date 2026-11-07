import type { Node } from '@/lib/old/nodes';
import { readCascadeNeeds } from '@/contours/nodes/lib/coreRemove';

/**
 * Удаление ноды, которая стоит в каскаде (E28, стенд 24.09: se-01 выходом
 * каскада 123).
 *
 * Сервер отказывает 409 `NODE_IN_USE_BY_CASCADE` под ЛЮБЫМ каскадом,
 * включённым или выключенным (nodes.service.ts deleteNode, 1bf18ca, A-126):
 * выключенный каскад включается одним щелчком, и позиции v4 указывали бы на
 * удалённую ноду. Экран говорит то же самое ДО кнопки, из
 * `cascadeNeedsEngines` ноды, и тот же отказ словами, если он всё же пришёл
 * (поле старое или ноду поставили в каскад между открытием окна и щелчком).
 */

/** Разбор 409 NODE_IN_USE_BY_CASCADE. Вход проверяется первым; `null` значит
 *  «отказ не этот». Имена каскадов, которые не строки, пропускаются; пустой
 *  список значит «сервер не назвал», и тост говорит общими словами. */
export function nodeDeleteRefusal(err: unknown): { cascades: string[]; message: string } | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 409 || !data || typeof data !== 'object') return null;
  const d = data as { error?: unknown; message?: unknown; cascades?: unknown };
  if (d.error !== 'NODE_IN_USE_BY_CASCADE') return null;
  return {
    cascades: Array.isArray(d.cascades) ? d.cascades.filter((c): c is string => typeof c === 'string' && c !== '') : [],
    message: typeof d.message === 'string' ? d.message : '',
  };
}

/**
 * Что окно удаления говорит про каскады ноды до кнопки.
 *
 *   null     поля `cascadeNeedsEngines` нет (панель старше) или оно кривое:
 *            окно как раньше, отсутствие не факт;
 *   blocked  имена всех каскадов ноды, включённых и выключенных: сервер
 *            откажет, кнопка недоступна.
 *
 * Одна нода стоит в каскаде под несколькими движками: имена по id без повторов.
 */
export type NodeDeleteFacts = { blocked: string[] } | null;

export function nodeDeleteFacts(node: Pick<Node, 'cascadeNeedsEngines'>): NodeDeleteFacts {
  const needs = readCascadeNeeds(node.cascadeNeedsEngines);
  if (needs === null) return null;
  const byId = new Map<string, string>();
  for (const list of needs.values()) for (const c of list) byId.set(c.id, c.name);
  return { blocked: [...byId.values()] };
}
