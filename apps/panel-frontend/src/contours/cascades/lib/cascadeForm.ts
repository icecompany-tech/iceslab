import { CHAIN_ENTRY_PROTOCOLS as SHARED_CHAIN_ENTRY_PROTOCOLS } from '@iceslab/shared';
import type { CascadeMode, CascadeProtocol } from '@/lib/domain/cascades';
import { linkCellPair, type EnginePair, type EngineName } from '@/lib/domain/engines';
import type { LinkCell, LinkParams } from '@/lib/domain/cascades';
import { AMBER, CYAN, DIM, MIST, MOSS, RED, VIOLET } from '@/contours/cascades/lib/colors';

/**
 * The shape of a cascade draft and the small functions that read it.
 *
 * These live beside the components rather than inside them: both cascade pages
 * and the editor itself need them, and a file that exports components can
 * export nothing else without the dev server losing hot reload for the whole
 * module.
 */

// Mirrors the backend cap (cascade.schemas MAX_CASCADE_HOPS); keep the two in
// sync. Each hop adds latency and one more inter-hop link port to open.
export const MAX_HOPS = 5;

export const MAX_POSITIONS = MAX_HOPS;

/** Entries multiplied by directions, each pair being one link with its own
 *  credentials. Mirrors the backend ceiling. */
export const MAX_LINKS = 64;

// The seven cores a hop link can speak. Narrower than the node protocol enum on
// purpose: tuic / anytls / shadowtls exist as node protocols but not as cascade
// links.
export const LINK_PROTOCOLS: { value: CascadeProtocol; label: string }[] = [
  { value: 'xray', label: 'xray' },
  { value: 'hysteria', label: 'hysteria2' },
  { value: 'shadowsocks', label: 'shadowsocks' },
  { value: 'amneziawg', label: 'amneziawg' },
  { value: 'naive', label: 'naive' },
  { value: 'mtproto', label: 'mtproto' },
  { value: 'mieru', label: 'mieru' },
];
export const LINK_PROTOCOL_VALUES = LINK_PROTOCOLS.map((p) => p.value) as string[];

/** The hop columns are free strings in the database, and the demo seed writes
 *  `vless` there, so a stored protocol is not guaranteed to be one the API will
 *  accept back. */
export function isKnownProtocol(v: string | null | undefined): boolean {
  return Boolean(v) && LINK_PROTOCOL_VALUES.includes(v as string);
}

/** Options for a protocol field, keeping an unknown stored value visible rather
 *  than rendering an empty select over data the operator cannot see. */
export function protocolOptions(current: string | null): { value: string; label: string }[] {
  if (!current || isKnownProtocol(current)) return LINK_PROTOCOLS;
  return [...LINK_PROTOCOLS, { value: current, label: current }];
}

/**
 * Через какие протоколы вход каскада действительно пускает трафик В ЦЕПЬ.
 *
 * ⚠ Список ОДИН и лежит в контракте (`packages/shared/src/transport.ts`): его
 * читает и отказ сохранения на сервере (`ENTRY_NOT_CHAINABLE`), и этот экран.
 * Своей копии здесь нет и быть не должно: вторая копия это ровно тот способ,
 * которым форма начинает предлагать вариант, отвергаемый сервером.
 *
 * Сегодня в нём один xray: вход на hy2 приедет с фазой 6, на AmneziaWG с
 * фазой 7. До этой правки экран обещал их обе: оператор выбирал hysteria2,
 * видел рядом «VLESS · ядро xray» и сохранял каскад, который не повезёт ни
 * одного клиента.
 */
export const CHAIN_ENTRY_PROTOCOLS: string[] = [...SHARED_CHAIN_ENTRY_PROTOCOLS];

/**
 * Пускает ли цепь трафик, зашедший этим протоколом.
 *
 * `null` это «сказать нечего»: протокол не выбран. Иначе ответ всегда есть, и
 * он про ФАКТ, а не про вкус: список умений приходит снаружи.
 */
export interface EntryChainFacts {
  protocol: string;
  carried: boolean;
}

export function entryChainFacts(
  entryProtocol: string | null | undefined,
  supported: string[] = CHAIN_ENTRY_PROTOCOLS,
): EntryChainFacts | null {
  const p = entryProtocol && entryProtocol.trim() !== '' ? entryProtocol : null;
  if (!p) return null;
  return { protocol: p, carried: supported.includes(p) };
}

export type HopRole = 'entry' | 'transit' | 'exit';

export const ROLE_TONE: Record<HopRole, string> = {
  entry: CYAN,
  transit: MIST,
  exit: MOSS,
};

/** A chain is one fixed path, a balancer is a choice, and the panel colours
 *  them apart wherever a mode is named. */
export const MODE_TONE: Record<CascadeMode, string> = {
  chain: CYAN,
  balancer: VIOLET,
};

/** One hop of the draft, before it becomes a CascadeHopInput. */
export interface HopDraft {
  /** Stable across reorder and delete, so React keeps the right field focused. */
  key: number;
  nodeId: string;
  entryProtocol: CascadeProtocol;
  linkProtocol: CascadeProtocol;
}

/** entry, then in a chain the last hop is the exit; in a balancer everything
 *  past the entry is a parallel exit. */
export function roleAt(index: number, count: number, mode: CascadeMode): HopRole {
  if (index === 0) return 'entry';
  return mode === 'balancer' || index === count - 1 ? 'exit' : 'transit';
}

/** chain: every hop but the last forwards to the next. balancer: only the entry
 *  carries a link, and it is the one protocol every exit link uses. */
export function carriesLinkAt(index: number, count: number, mode: CascadeMode): boolean {
  return mode === 'balancer' ? index === 0 : index < count - 1;
}

/** The hops as the API wants them: entryProtocol only on the entry, and a link
 *  protocol only where the role actually carries one. */
export function toHopInputs(hops: HopDraft[], mode: CascadeMode) {
  return hops.map((h, i) => ({
    nodeId: h.nodeId,
    position: i,
    ...(i === 0 ? { entryProtocol: h.entryProtocol } : {}),
    ...(carriesLinkAt(i, hops.length, mode) ? { linkProtocol: h.linkProtocol } : {}),
  }));
}

/** The cascade list's status palette, so a node keeps its colour between the
 *  picker here and the card it appears on afterwards. */
export function statusTone(status: string): string {
  if (status === 'online') return MOSS;
  if (status === 'offline') return DIM;
  if (status === 'unreachable') return RED;
  return AMBER;
}

/**
 * The newer shape of the same idea. A POSITION is one step of the path and
 * holds a pool of nodes that all do the same job; a DIRECTION is a way out and
 * owns a tag for good, whatever nodes currently sit under it.
 *
 * The exit position is not a pool: it is the list of directions, which is why
 * the counter on the page adds one to the pools.
 */

export interface PositionDraft {
  key: number;
  nodeIds: string[];
  entryProtocol: CascadeProtocol;
  linkProtocol: CascadeProtocol;
}

export interface DirectionDraft {
  key: number;
  countryCode: string;
  nodeIds: string[];
  /**
   * Server identity of a direction that already exists. This is what carries
   * the tag across an edit, so it is threaded through the draft untouched and
   * sent back on save. Null means the row is new and the panel will issue it a
   * fresh tag.
   */
  id: string | null;
  /** Issued by the backend on first save, and never reused. Null while drafting. */
  tag: number | null;
  /**
   * Нога направления, фаза 5. Три значения, как в контракте: `undefined` это
   * «сервер поля не отдаёт», `null` это «ячейка не выбрана, идём ячейкой
   * входа».
   */
  linkProtocol?: LinkCell | null;
  linkParams?: LinkParams | null;
  /** Только для показа: назначает сервер, обратно не уходит никогда. */
  linkPort?: number | null;
  /**
   * Правил ли оператор ногу этого направления.
   *
   * Отдельный флаг, а не сравнение значений: PUT шлёт ногу ТОЛЬКО когда её
   * трогали. Без флага сохранение экрана, который поля даже не показывал,
   * отправило бы `null` и стёрло бы ячейку на сервере, ровно как сохранение
   * сквада стёрло profileIds 2026-07-31.
   */
  linkTouched?: boolean;
}

/** Pools are the entry and whatever transits follow it; the exit is the
 *  directions block, so it is never a pool. */
export function poolRoleAt(index: number): HopRole {
  return index === 0 ? 'entry' : 'transit';
}

export function toPositionInputs(pools: PositionDraft[]) {
  return pools.map((p, i) => ({
    nodeIds: p.nodeIds.filter(Boolean),
    position: i,
    ...(i === 0 ? { entryProtocol: p.entryProtocol } : {}),
    linkProtocol: p.linkProtocol,
  }));
}

/**
 * ⚠ The `id` is the whole point of this function. A direction that goes back
 * without one is a NEW direction to the API: it gets a fresh tag, and every
 * client whose UUID carries the old tag quietly starts leaving through another
 * country. The API does fall back to matching on the node set, but that stops
 * working exactly when the pool is edited, which is the ordinary reason to open
 * this form at all.
 *
 * `tag` is deliberately not sent. The panel issues tags and never reuses them,
 * so a tag from the client could only contradict the server.
 */
export function toDirectionInputs(directions: DirectionDraft[]) {
  return directions.map((d) => ({
    ...(d.id ? { id: d.id } : {}),
    countryCode: d.countryCode,
    nodeIds: d.nodeIds.filter(Boolean),
    // Нога уходит ТОЛЬКО если её правили. До фазы 5 полей нет вовсе, и
    // отправленный `null` означал бы «сбрось ячейку», а не «я про неё ничего
    // не знаю». `linkPort` не отправляется никогда: его назначает сервер.
    ...(d.linkTouched
      ? { linkProtocol: d.linkProtocol ?? null, linkParams: d.linkParams ?? null }
      : {}),
  }));
}

/**
 * Что показать в строке пула на месте выбора ноды.
 *
 * Три случая, и третий выглядел как первый. Строка держит `nodeId`, а ноды с
 * таким id в списке нет: её удалили после того, как каскад сохранили. Селектор
 * не находит значение среди опций и рисуется ПУСТЫМ, то есть говорит «оператор
 * не выбрал ноду». Это ложь о причине, и она дорогая: человек идёт выбирать
 * ноду заново вместо того, чтобы понять, что направление осталось без машины.
 *
 * `missing` несёт сам id: он единственная зацепка, по которой пропажу можно
 * найти в логах и в чужих каскадах.
 */
export type PoolRowState = 'empty' | 'known' | 'missing';

export interface PoolRowFacts {
  state: PoolRowState;
  /** Есть у `known` и `missing`. */
  nodeId?: string;
  /** Первые восемь знаков id, чтобы строка не расползалась. Только у `missing`:
   *  у известной ноды показывается имя, а не идентификатор. */
  shortId?: string;
}

export function poolRowFacts(nodeId: string, nodes: { id: string }[]): PoolRowFacts {
  // Пустая строка это «оператор ещё не выбрал», и селектор тут прав.
  if (!nodeId) return { state: 'empty' };
  if (nodes.some((n) => n.id === nodeId)) return { state: 'known', nodeId };
  return { state: 'missing', nodeId, shortId: nodeId.slice(0, 8) };
}

/**
 * Когда каскад в последний раз ПЫТАЛИСЬ разослать, и чем это кончилось.
 *
 * Карточка «последний пуш» показывала время сохранения каскада и слово «ещё не
 * применено». По отдельности верно, вместе врёт: «36 дней назад, не
 * применено» читается как «давно ничего не делали», тогда как сегодня пытались
 * трижды и трижды получили отказ. Отвергнутый пуш не двигает
 * `lastInboundSyncAt`, потому что тот штампуется только при успехе, и время
 * попытки лежит в `lastInboundSyncError.at`.
 *
 * Попытка хопа это ПОЗДНЕЙШЕЕ из двух. Попытка каскада это позднейшая по
 * хопам: цепь рассылается разом, и последняя из них и есть «когда пробовали».
 *
 * `null` означает «сказать нечего»: ни один хоп не отчитался ни успехом, ни
 * отказом. Строки тогда нет вовсе, потому что пустое время хуже молчания.
 */
export interface LastAttemptFacts {
  /** ISO позднейшей попытки по всем хопам. */
  at: string;
  /** Сколько хопов отвергли её последними. */
  refused: number;
  /** Сколько хопов вообще отчитались, то есть знаменатель для «2 из 4». */
  answered: number;
}

export function lastAttemptFacts(
  hops: { nodeId: string }[],
  nodeById: Map<string, { lastInboundSyncAt?: string | null; lastInboundSyncError?: { at: string } | null }>,
): LastAttemptFacts | null {
  let at: string | null = null;
  let refused = 0;
  let answered = 0;

  for (const hop of hops) {
    const node = nodeById.get(hop.nodeId);
    const ok = node?.lastInboundSyncAt ?? null;
    const bad = node?.lastInboundSyncError?.at ?? null;
    if (!ok && !bad) continue;
    answered++;
    // Сравнение строк ISO работает как сравнение моментов, пока обе в UTC с
    // одинаковой точностью, а сервер отдаёт именно такие. Date здесь дал бы то
    // же самое дороже.
    const last = ok && bad ? (bad > ok ? bad : ok) : (bad ?? ok)!;
    if (bad && (!ok || bad > ok)) refused++;
    if (!at || last > at) at = last;
  }

  return at ? { at, refused, answered } : null;
}

/**
 * Порт ноги назначает ПАНЕЛЬ, а не оператор: линк с позиции i слушает на
 * ПРИНИМАЮЩЕЙ ноде порт `LINK_PORT_BASE + i`.
 *
 * Зеркало `LINK_PORT_BASE` из `cascade.config.ts:28` бэкенда. Число здесь
 * только показывается: менять его отсюда нечем и не нужно, но и прятать нельзя,
 * потому что именно его оператор открывает в фаерволе, когда линк не встаёт.
 */
export const LEG_PORT_BASE = 24000;

/**
 * Одна нога пути: чем позиция N говорит с тем, что за ней.
 *
 * Три состояния, и «неизвестно» тут не то же, что «не выбрано»: в колонке
 * лежит свободная строка, и сохранённое значение может не совпадать ни с одной
 * ячейкой, которую панель умеет собрать (список ячеек короткий сознательно, см.
 * `LINK_CELLS`). Тогда показывается то, что записано, и это НЕ выдаётся за
 * рабочую ногу.
 *
 * `pair` заполнен только у реализованной ячейки: пару протокол+движок нельзя
 * вывести из имени, которого панель не знает, а угадать её значило бы сказать
 * оператору, чем ходит трафик, не имея на это оснований.
 */
export type LegState = 'known' | 'unrealised' | 'unknown';

export interface LegFacts {
  state: LegState;
  /** Что записано в колонке. `null` только у `unknown`. */
  cell: string | null;
  /** Протокол и движок ячейки. Есть только у двух встроенных ячеек. */
  pair: EnginePair | null;
  /** Порт на принимающей стороне: 24000 + номер шага. */
  port: number;
  /** Движки ячейки по таблице контракта. Есть у `known`, которую опознала
   *  таблица, а не встроенный список. */
  engines?: EngineName[];
}

export function legFacts(
  linkProtocol: string | null | undefined,
  step: number,
  /** Движки ячейки по таблице контракта; `undefined` = ячейка чужая. Приходит
   *  снаружи, чтобы функция осталась чистой и проверяемой. */
  enginesOf?: (cell: string) => readonly EngineName[] | undefined,
): LegFacts {
  const port = LEG_PORT_BASE + step;
  const cell = linkProtocol && linkProtocol.trim() !== '' ? linkProtocol : null;
  if (!cell) return { state: 'unknown', cell: null, pair: null, port };

  // Две ячейки панель собирала всегда, и их пару она знает точно.
  const pair = linkCellPair(cell);
  if (pair) return { state: 'known', cell, pair, port };

  // Остальные (hy2, tuic) становятся рабочими РОВНО тогда, когда таблица
  // контракта называет движки. До этого прежнее поведение: показываем, что
  // записано, и не выдаём это за рабочую ногу.
  const engines = enginesOf?.(cell);
  if (engines && engines.length > 0) return { state: 'known', cell, pair: null, port, engines: [...engines] };
  return { state: 'unrealised', cell, pair: null, port };
}

/**
 * Ноды направления, которые ТОЧНО не несут выбранную ячейку.
 *
 * Возвращается только доказанное «нет»: нода отчиталась о своих движках, и
 * среди них нет ни одного, кем ячейка поднимается. Молчащая нода и ячейка, про
 * которую таблицы нет, сюда не попадают вовсе: это незнание, а красная строка
 * про незнание врёт. То же правило, что стоило 23 отказов рабочим парам
 * 2026-09-11.
 *
 * `engines` в ответе это то, что нода сообщила о себе: без этого списка
 * оператору некуда идти, кроме как гадать.
 */
export interface CellGap {
  nodeId: string;
  name: string;
  engines: EngineName[];
}

export function cellGaps(
  nodeIds: string[],
  cell: string | null | undefined,
  nodeById: Map<string, { name: string; engines?: EngineName[] }>,
  carries: (node: { engines?: EngineName[] } | undefined, cell: string) => boolean | undefined,
): CellGap[] {
  if (!cell) return [];
  const gaps: CellGap[] = [];
  for (const id of nodeIds) {
    if (!id) continue;
    const node = nodeById.get(id);
    if (!node) continue;
    if (carries(node, cell) !== false) continue;
    gaps.push({ nodeId: id, name: node.name, engines: node.engines ?? [] });
  }
  return gaps;
}

