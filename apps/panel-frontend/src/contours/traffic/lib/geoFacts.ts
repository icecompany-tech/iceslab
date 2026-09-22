import type { GeoRolloutNode, GeoSet } from '@/lib/domain/geoSets';

/**
 * Что показать на экране гео-наборов и что известно про каждую ноду.
 *
 * Разметка отсюда только красит. Три состояния экрана те же, что у шаблонов, и
 * путать их так же дорого: «сервер ещё не умеет» вместо «пусто» зовёт заводить
 * набор там, где его негде сохранить.
 */
export type GeoScreenState = 'unavailable' | 'empty' | 'list';

export interface GeoScreenFacts {
  state: GeoScreenState;
  sets: GeoSet[];
  total: number;
}

export function geoScreenFacts(input: {
  sets?: GeoSet[];
  notImplemented?: boolean;
}): GeoScreenFacts {
  if (input.notImplemented) return { state: 'unavailable', sets: [], total: 0 };
  const list = input.sets;
  // Ответа ещё нет: это не «пусто». Сказать «наборов нет» на полсекунды каждому
  // открытию значит соврать про чужую работу.
  if (!list) return { state: 'unavailable', sets: [], total: 0 };
  if (list.length === 0) return { state: 'empty', sets: [], total: 0 };
  // Сначала сломанные, потом качающиеся, потом готовые: экран открывают, когда
  // что-то не так, а не чтобы полюбоваться готовыми.
  const rank = (s: GeoSet) => (s.status === 'invalid' ? 0 : s.status === 'fetching' ? 1 : 2);
  const sets = [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { state: 'list', sets, total: list.length };
}

/**
 * Что лежит на одной ноде против того, что забрала панель.
 *
 * ЧЕТЫРЕ ответа, и три из них не «всё хорошо»:
 *   `same`      версия совпала с панельной;
 *   `behind`    версия другая, и нода применила её ДО того, как панель забрала
 *               текущую: обычный случай, пуш ещё не дошёл;
 *   `diverged`  версия другая, и нода применила её ПОСЛЕ панельной. Панель
 *               такого не посылала: кто-то положил файл руками. Янтарное;
 *   `unknown`   нода ничего не сообщила ИЛИ сообщила версию без времени, и
 *               тогда сказать, отстаёт она или ушла вперёд, нечем.
 *
 * ⚠ Порядок берётся из ВРЕМЕНИ, а не из текста версии: версия это тег или
 * первые 12 знаков sha256, и sha не сравнивается на «старше». Поэтому при
 * различии версий без отметки времени честный ответ это `unknown`, а не
 * догадка в любую сторону.
 */
export type RolloutState = 'same' | 'behind' | 'diverged' | 'unknown';

export interface RolloutFacts {
  nodeId: string;
  state: RolloutState;
  /** Что лежит на ноде; `null` = не сообщала. */
  version: string | null;
  appliedAt: string | null;
}

export function rolloutFacts(
  set: Pick<GeoSet, 'version' | 'fetchedAt'>,
  node: GeoRolloutNode,
): RolloutFacts {
  const base = { nodeId: node.nodeId, version: node.version, appliedAt: node.appliedAt };
  if (!node.version) return { ...base, state: 'unknown' };
  if (node.version === set.version) return { ...base, state: 'same' };
  if (!node.appliedAt || !set.fetchedAt) return { ...base, state: 'unknown' };
  // Сравнение строк ISO работает как сравнение моментов, пока обе в UTC с
  // одинаковой точностью, а сервер отдаёт именно такие.
  return { ...base, state: node.appliedAt > set.fetchedAt ? 'diverged' : 'behind' };
}

/** Сводка по набору: «на 3 из 4» и есть ли на что смотреть. */
export interface RolloutSummary {
  same: number;
  total: number;
  behind: number;
  diverged: number;
  unknown: number;
  /** Хоть одна нода ушла вперёд: это руками положенный файл. */
  hasDiverged: boolean;
}

export function rolloutSummary(
  set: Pick<GeoSet, 'version' | 'fetchedAt'>,
  nodes: GeoRolloutNode[],
): RolloutSummary {
  const states = nodes.map((n) => rolloutFacts(set, n).state);
  const count = (s: RolloutState) => states.filter((x) => x === s).length;
  return {
    same: count('same'),
    total: nodes.length,
    behind: count('behind'),
    diverged: count('diverged'),
    unknown: count('unknown'),
    hasDiverged: count('diverged') > 0,
  };
}

/**
 * Что можно сделать с набором.
 *
 * Обновить источник можно только у `url` и `builtin`: загруженный файл берётся
 * с машины оператора, и «обновить» у него означало бы загрузить заново, то есть
 * другую кнопку.
 *
 * Удаление экран не запрещает: какие политики держат набор, знает сервер, и его
 * 409 называет их поимённо. Запрет по неполному знанию здесь был бы тем же
 * отказом по вычисленной величине, что стоил 23 рабочих пар 2026-09-11.
 */
export interface GeoSetActions {
  canRefresh: boolean;
  canDelete: boolean;
}

export function geoSetActions(set: Pick<GeoSet, 'source' | 'status'>): GeoSetActions {
  return {
    canRefresh: set.source.type !== 'upload' && set.status !== 'fetching',
    canDelete: set.status !== 'fetching',
  };
}
