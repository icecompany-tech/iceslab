import { ENGINE_NAMES, type EngineName } from '@iceslab/shared';
import type { CascadeEngineNeed, Node, NodeCore } from '@/lib/domain/nodes';

/**
 * «Как удалить» у ядра на странице ноды (core-lifecycle §8).
 *
 * Панель ничего не удаляет: она показывает строку для ssh, и только когда по
 * ФАКТАМ ядро никому не нужно. Отказ говорит, кому нужно, вместо кнопки.
 * Три факта, каждый может сказать «нет» сам по себе:
 *
 *   hosts    `neededBy > 0`: на ноде включённые хосты этого движка;
 *   cascade  нода в каскаде, которому движок нужен (sing-box у цепи, xray у
 *            входа), выключенный каскад тоже: он сломается при включении;
 *   last     движок единственный в `intendedEngines`: последнее ядро ноды.
 *            Основного ядра нет (решение владельца 25.09), порядок списка
 *            ничего не значит, поэтому отказ по месту в списке ушёл.
 *
 * Сказать «да» можно только когда известны ВСЕ три. Нет `neededBy`, нет
 * `cascadeNeedsEngines` или нет `intendedEngines` (сервер старше поля): это не
 * «никому не нужно», а «панель не сообщила», и кнопки тогда нет. Частичный
 * факт годится для «нет» и не годится для «да».
 *
 * Удаляется ДВИЖОК, а не строка: агент регистрирует sing-box под несколькими
 * протоколами, строк с одним движком может быть несколько, и решение и кнопка
 * одни на движок, у его первой строки.
 */

export type CoreRemoveRefusal =
  | { kind: 'hosts'; count: number }
  | { kind: 'cascade'; name: string; enabled: boolean }
  | { kind: 'last' };

export type CoreRemoveFacts =
  /** Файла на машине нет: удалять нечего. */
  | { kind: 'absent' }
  | { kind: 'refused'; reasons: CoreRemoveRefusal[] }
  /** Отказать не в чем, но и сказать «да» не на чем: какие поля молчат. */
  | { kind: 'unknown'; missing: ('hosts' | 'cascades' | 'intent')[] }
  /** Можно. `dropped`: движок снят из ядер ноды, а на машине стоит. */
  | { kind: 'allowed'; dropped: boolean };

/**
 * `cascadeNeedsEngines` как факт: Map движок -> каскады, или null, если поля
 * нет или форма не та. Одна кривая запись делает весь список не фактом: её
 * пропуск мог бы спрятать как раз тот каскад, который запрещает удаление.
 */
export function readCascadeNeeds(raw: unknown): Map<EngineName, CascadeEngineNeed['cascades']> | null {
  if (!Array.isArray(raw)) return null;
  const out = new Map<EngineName, CascadeEngineNeed['cascades']>();
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) return null;
    const { engine, cascades } = e as { engine?: unknown; cascades?: unknown };
    if (typeof engine !== 'string' || !(ENGINE_NAMES as readonly string[]).includes(engine)) return null;
    if (!Array.isArray(cascades)) return null;
    const list: CascadeEngineNeed['cascades'] = [];
    for (const c of cascades) {
      if (typeof c !== 'object' || c === null) return null;
      const { id, name, enabled } = c as { id?: unknown; name?: unknown; enabled?: unknown };
      if (typeof id !== 'string' || typeof name !== 'string' || typeof enabled !== 'boolean') return null;
      list.push({ id, name, enabled });
    }
    out.set(engine as EngineName, [...(out.get(engine as EngineName) ?? []), ...list]);
  }
  return out;
}

/** Движок строки ядра: свой `engine`, у строки без него имя ядра. */
export function coreEngine(core: Pick<NodeCore, 'name' | 'engine'>): EngineName | null {
  const e = core.engine ?? core.name;
  return (ENGINE_NAMES as readonly string[]).includes(e) ? (e as EngineName) : null;
}

export function coreRemoveFacts(
  engine: EngineName,
  node: Pick<Node, 'cores' | 'intendedEngines' | 'cascadeNeedsEngines'>,
): CoreRemoveFacts {
  const rows = (node.cores?.cores ?? []).filter((c) => coreEngine(c) === engine);
  // Стоит, если хоть одна строка движка не сказала «файла нет». Молчание
  // (агент старше поля) читается как «стоит», как везде в «Ядрах».
  if (rows.length === 0 || rows.every((c) => c.installed === false)) return { kind: 'absent' };

  const reasons: CoreRemoveRefusal[] = [];
  const missing: ('hosts' | 'cascades' | 'intent')[] = [];

  // Хосты: у строк одного движка число одно и то же; берём наибольшее, чтобы
  // расхождение не превратилось в «можно».
  const counts = rows.map((c) => c.neededBy).filter((n): n is number => typeof n === 'number');
  if (counts.length === 0) missing.push('hosts');
  else if (Math.max(...counts) > 0) reasons.push({ kind: 'hosts', count: Math.max(...counts) });

  const needs = readCascadeNeeds(node.cascadeNeedsEngines);
  if (needs === null) missing.push('cascades');
  else for (const c of needs.get(engine) ?? []) reasons.push({ kind: 'cascade', name: c.name, enabled: c.enabled });

  const intended = node.intendedEngines;
  if (intended === undefined) missing.push('intent');
  else if (intended.length === 1 && intended[0] === engine) reasons.push({ kind: 'last' });

  if (reasons.length > 0) return { kind: 'refused', reasons };
  if (missing.length > 0) return { kind: 'unknown', missing };
  return { kind: 'allowed', dropped: !intended!.includes(engine) };
}

/**
 * У какой строки рисовать «Как удалить»: у первой строки каждого движка, чтобы
 * у sing-box под тремя протоколами кнопка была одна.
 */
export function firstRowOfEngine(cores: readonly Pick<NodeCore, 'name' | 'engine'>[], index: number): boolean {
  const e = coreEngine(cores[index]!);
  if (e === null) return false;
  return cores.findIndex((c) => coreEngine(c) === e) === index;
}
