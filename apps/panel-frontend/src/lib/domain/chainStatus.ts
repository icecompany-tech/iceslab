import type { Node } from '@/lib/domain/nodes';

/**
 * Работает ли на ноде процесс цепи, и имеем ли мы право что-то про это сказать.
 *
 * Поле читается ТОЛЬКО парой: `chainSentAt` это что сделали МЫ, `chainStatus`
 * это что ответила НОДА, и по отдельности ни одно из них ничего не значит.
 * Пустой `chainStatus` у ноды, которой блок цепи не посылали, это норма и
 * состояние всего парка до фазы 4; покрасить его в красное значит зажечь всю
 * панель в день, когда поле завели.
 *
 * Четыре ответа, и три из них НЕ красные:
 *   `null`      цепи тут нет и не должно быть, рисовать нечего;
 *   `unknown`   блок послали, нода молчит: агент старше поля или ещё не
 *               отчиталась. Серое «нет данных», не отказ;
 *   `down`      нода сказала «не работает». Красное, словами ядра;
 *   `up`        работает, с версией.
 *
 * ⚠ Статус самой ноды при упавшей цепи приходит `degraded` с
 * `lastStatusMessage` вида «chain-process: ...». Разбирать эту строку нельзя:
 * она для человека, а факт лежит в `chainStatus`.
 */
export type ChainFacts =
  | { state: 'unknown'; sentAt: string }
  | { state: 'down'; sentAt: string; error: string | null }
  | { state: 'up'; sentAt: string; version: string | null }
  /**
   * E57: связи с нодой нет (offline, unreachable), а отчёт о цепи остался от
   * последнего опроса. Это не текущее знание: серым, «по последнему отчёту»,
   * с временем потери связи (`since`, `lastStatusChange`).
   */
  | { state: 'stale'; sentAt: string; was: 'up' | 'down'; version: string | null; since: string | null };

/** Статусы ноды, при которых панель с ней не говорит. */
const UNREACHABLE = new Set(['offline', 'unreachable']);

export function chainFacts(
  node:
    | (Pick<Node, 'chainStatus' | 'chainSentAt'> & Partial<Pick<Node, 'status' | 'lastStatusChange'>>)
    | null
    | undefined,
): ChainFacts | null {
  const sentAt = node?.chainSentAt ?? null;
  // Нода может отчитаться о цепи, которую мы не посылали (ручной конфиг,
  // остаток от прошлого каскада). Говорить об этом на экране каскада нечего:
  // панель за этот процесс не отвечает и управлять им не умеет.
  if (!sentAt) return null;

  const chain = node?.chainStatus ?? null;
  if (!chain) return { state: 'unknown', sentAt };

  // Нода недоступна: отчёт старый, «работает» или «не работает» уже не факт.
  if (node?.status && UNREACHABLE.has(node.status)) {
    const v = typeof chain.version === 'string' ? chain.version.trim() : '';
    return {
      state: 'stale',
      sentAt,
      was: chain.running ? 'up' : 'down',
      version: v === '' ? null : v,
      since: node.lastStatusChange ?? null,
    };
  }

  if (chain.running) {
    const v = typeof chain.version === 'string' ? chain.version.trim() : '';
    return { state: 'up', sentAt, version: v === '' ? null : v };
  }

  const e = typeof chain.error === 'string' ? chain.error.trim() : '';
  // Отсутствующая причина это не пустая строка на экране: «не работает» само
  // по себе уже факт, а выдуманного текста под ним быть не должно.
  return { state: 'down', sentAt, error: e === '' ? null : e };
}
