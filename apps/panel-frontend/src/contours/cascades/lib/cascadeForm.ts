import { CHAIN_ENTRY_PROTOCOLS as SHARED_CHAIN_ENTRY_PROTOCOLS } from '@iceslab/shared';
import type { CascadeMode, CascadeProtocol } from '@/lib/domain/cascades';
import { linkCellPair, type EnginePair, type EngineName } from '@/lib/domain/engines';
import { DEFAULT_LINK_CONGESTION, DEFAULT_LINK_UNDERLAY, LINK_CONGESTIONS } from '@/lib/domain/cascades';
import type { LinkCell, LinkCongestion, LinkParams, LinkUnderlay } from '@/lib/domain/cascades';
import type { Node } from '@/lib/domain/nodes';
import { nodeCoreFit } from '@/lib/domain/nodeCoreFit';
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

/** Поддержанные входы строкой для текста отказа: имена как на проводе
 *  (`hysteria`, не подпись «hysteria2»), тем же списком, что читает сервер. */
export function chainEntryList(): string {
  return CHAIN_ENTRY_PROTOCOLS.join(', ');
}

/**
 * Пускает ли цепь трафик, зашедший этим протоколом.
 *
 * `null` это «сказать нечего»: протокол не выбран. Иначе ответ всегда есть, и
 * он про ФАКТ, а не про вкус: список умений приходит снаружи.
 */
export interface EntryChainFacts {
  protocol: string;
  carried: boolean;
  /**
   * Может ли КЛИЕНТ этого входа выбирать выход сам.
   *
   * Выбор выхода по пользователю это трюк xray: направление едет в байтах
   * UUID, которым клиент авторизуется. У входа на hysteria такого канала нет,
   * поэтому его клиенты выходят через «Авто» или по правилам политики. Это
   * граница фазы 6, и молчать о ней нельзя: оператор, выбравший hy2-вход,
   * иначе узнает о ней от пользователя, который «не может выбрать страну».
   *
   * Отдельное поле, а не вывод из `carried`: с фазой 7 приедет AmneziaWG, и он
   * будет таким же, то есть несомым, но без выбора по пользователю.
   */
  perUserExit: boolean;
}

/**
 * Сегодня выбор выхода по пользователю умеет один xray. Список короткий и
 * лежит здесь, а не в контракте: сервер по нему ничего не решает, это свойство
 * КЛИЕНТСКОГО протокола, о котором панель рассказывает оператору.
 */
const PER_USER_EXIT_PROTOCOLS = ['xray'];

export function entryChainFacts(
  entryProtocol: string | null | undefined,
  supported: string[] = CHAIN_ENTRY_PROTOCOLS,
): EntryChainFacts | null {
  const p = entryProtocol && entryProtocol.trim() !== '' ? entryProtocol : null;
  if (!p) return null;
  return {
    protocol: p,
    carried: supported.includes(p),
    perUserExit: PER_USER_EXIT_PROTOCOLS.includes(p),
  };
}

/**
 * Что сказать под селектором входа.
 *
 * `notCarried` это отказ: цепь такой трафик не несёт, сохранять нельзя.
 * `autoOnly` это граница, а не ошибка: вход несётся, но его клиенты не
 * выбирают выход сами, только «Авто» или правила политики. С фазы 6 это
 * hysteria, с фазы 7 будет и AmneziaWG. `null` это «сказать нечего».
 *
 * Порядок проверок важен: у несомого-с-ограничением сначала должно
 * срабатывать «несётся ли вообще». Пока `CHAIN_ENTRY_PROTOCOLS` держит один
 * xray, у hysteria стоит отказ, а про «Авто» молчание: обещать выбор через
 * «Авто» у входа, который никуда не ведёт, значит врать дважды.
 */
export type EntryNoteKind = 'notCarried' | 'autoOnly';

export function entryNoteKind(facts: EntryChainFacts | null): EntryNoteKind | null {
  if (!facts) return null;
  if (!facts.carried) return 'notCarried';
  if (!facts.perUserExit) return 'autoOnly';
  return null;
}

/**
 * Профили на входной ноде, которые в каскад НЕ входят.
 *
 * На каскаде один протокол входа (фаза 6). Всё, что привязано к входной ноде
 * другим протоколом, живёт мимо каскада, и его пользователи выходят напрямую из
 * страны этой ноды. Это факт модели, а не поломка, и оператор должен видеть
 * его в момент выбора входа, а не когда пользователь hy2 спросит, почему у
 * него IP входа.
 *
 * `undefined` это «сказать нечего», и его два разных повода: вход не выбран,
 * или привязки с профилями ещё не пришли. Во втором случае строка про «нет
 * чужих профилей» соврала бы, поэтому молчание, а не пустой список.
 *
 * Сравнение идёт по ПРОТОКОЛУ профиля, тем же правилом, что у сервера: при
 * смене входа он снимал с каскада профиль `hy2` именно как hysteria-профиль.
 * Выключенная привязка в счёт не идёт: пользователей через неё нет.
 */
export interface EntryBystander {
  nodeId: string;
  nodeName: string;
  countryCode: string | null;
  protocols: string[];
}

export function entryBystanders(
  entryProtocol: string | null | undefined,
  entryNodes: { id: string; name: string; countryCode: string | null }[],
  bindings: { profileId: string; nodeId: string; enabled: boolean }[] | undefined,
  profiles: { id: string; protocol: string }[] | undefined,
): EntryBystander[] | undefined {
  if (!entryProtocol || !bindings || !profiles) return undefined;
  const protocolOf = new Map(profiles.map((p) => [p.id, p.protocol]));
  const out: EntryBystander[] = [];
  for (const node of entryNodes) {
    const foreign = new Set<string>();
    for (const b of bindings) {
      if (b.nodeId !== node.id || !b.enabled) continue;
      const proto = protocolOf.get(b.profileId);
      // Профиль, которого нет в списке, ничего не говорит о протоколе: его не
      // считаем, чтобы не назвать чужим то, чего мы просто не видим.
      if (proto && proto !== entryProtocol) foreign.add(proto);
    }
    if (foreign.size > 0) {
      out.push({ nodeId: node.id, nodeName: node.name, countryCode: node.countryCode, protocols: [...foreign].sort() });
    }
  }
  return out;
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
  /**
   * ЯЧЕЙКА ноги, а не протокол ноды, и это разные словари.
   *
   * Тип был `CascadeProtocol`, и совпадал он случайно: пока ячеек было две,
   * `xray` и `shadowsocks` нашлись и среди протоколов. С четырьмя ячейками
   * `hy2` и `tuic` в этот тип не лезут, а экраны и так приводили значение
   * кастом. Здесь строка, потому что колонка в базе строка и может держать
   * значение, которого панель не знает; что из этого сервер примет, решает
   * `isRealisedLinkCell` и схема на бэкенде.
   */
  linkProtocol: string;
  /**
   * Настройки ноги ЭТОЙ позиции. То же поле и то же правило, что у
   * направления: три значения на чтении, и на записи отсутствие ключа значит
   * «не трогай».
   */
  linkParams?: LinkParams | null;
  /** Правил ли оператор ногу этой позиции. Без флага сохранение экрана, на
   *  котором поля никто не трогал, отправило бы `null` и сбросило бы выбор. */
  linkTouched?: boolean;
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

/**
 * ⚠ `linkParams` уходит ТОЛЬКО если оператор его правил.
 *
 * То же правило, что у направления, и по той же причине: у сервера отсутствие
 * ключа значит «не трогай», а `null` значит «сбросить». Экран, который поля не
 * показывал или показывал, но не трогал, отправив `null`, стёр бы чужой выбор
 * (инцидент 2026-07-31 со сквадом, и он же в новом месте 2026-09-22, когда
 * правка ноги одного направления снимала ногу соседнему).
 */
export function toPositionInputs(pools: PositionDraft[]) {
  return pools.map((p, i) => ({
    nodeIds: p.nodeIds.filter(Boolean),
    position: i,
    ...(i === 0 ? { entryProtocol: p.entryProtocol } : {}),
    linkProtocol: p.linkProtocol,
    ...(p.linkTouched ? { linkParams: p.linkParams ?? null } : {}),
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

/**
 * Что у ноги настраивается сверх выбора ячейки.
 *
 * Решает не разметка: список спрошен у ДВИЖКА, и цена ошибки тут не косметика,
 * а лежачая нода при зелёном «сохранено» в панели.
 *
 * `minted` (hy2): настраивать нечем. Соль Salamander рождает панель, как и
 * остальные креды линка, а `congestion_control` sing-box 1.13.14 на hysteria2
 * отвергает ПРИ РАЗБОРЕ конфига, то есть поле там не игнорируется. Скорость у
 * hy2 это Brutal, и задаётся она парой чисел про полосу; решено 2026-09-22 не
 * спрашивать её здесь вовсе: полоса это свойство канала НОДЫ, а не ноги, и без
 * пары чисел sing-box ведёт hy2 по BBR, что для линка между дата-центрами
 * рабочий дефолт.
 *
 * `congestion` (tuic): ровно три значения, и это ответ движка, а не выписка со
 * страницы документации. `brutal` sing-box на tuic не знает и отвечает
 * «unknown congestion control algorithm», поэтому предложить его значило бы
 * положить ногу. `new_reno` пишется с подчёркиванием, ровно так он принимается.
 */
export type LegParamKind = 'none' | 'minted' | 'congestion';

export interface LegParamFacts {
  kind: LegParamKind;
  /** Только у `congestion`: что предлагать и что стоит, если не выбрали. */
  options: LinkCongestion[];
  fallback: LinkCongestion | null;
}

export function legParamFacts(cell: string | null | undefined): LegParamFacts {
  if (cell === 'hy2') return { kind: 'minted', options: [], fallback: null };
  if (cell === 'tuic') {
    return { kind: 'congestion', options: [...LINK_CONGESTIONS], fallback: DEFAULT_LINK_CONGESTION };
  }
  return { kind: 'none', options: [], fallback: null };
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

/**
 * Отказ сервера записать ногу: 409 `CELL_NOT_CARRIED`.
 *
 * Второй источник тех же фактов, что и `cellGaps`. Первый предсказывает по
 * тому, что нода рассказала о себе, второй приходит от сервера в момент
 * сохранения, и перечисляет ВСЕ заблокированные ноги, а не первую. Слова у
 * них одни: «<нода> не несёт <ячейку>: сообщила <движки>». Источники разные,
 * повод для оператора один, и две разные формулировки читались бы как две
 * разные беды.
 *
 * ⚠ Первым делом проверяется ВХОД. У react-query `error` это `null`, когда
 * ошибки нет, и разбор, читающий `err.response` без проверки, роняет экран
 * белым на первом же открытии: `unknown` после каста разрешает читать что
 * угодно, и ни сборка, ни линт этого не видят (поймано 22.09 на шаблонах).
 *
 * `null` в ответе это «отказ не этот»: вызывающий идёт своей прежней дорогой.
 * Пустой массив был бы «отказ этот, но конфликтов нет», а такого ответа
 * сервер не шлёт.
 */
export interface CellRefusal {
  nodeName: string;
  cell: string;
  engines: EngineName[];
}

export function refusedCells(err: unknown): CellRefusal[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!res || res.status !== 409) return null;
  const data = res.data as { error?: string; conflicts?: unknown } | undefined;
  if (!data || data.error !== 'CELL_NOT_CARRIED') return null;
  if (!Array.isArray(data.conflicts)) return null;
  const out: CellRefusal[] = [];
  for (const raw of data.conflicts) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as { nodeName?: unknown; cell?: unknown; engines?: unknown };
    if (typeof c.nodeName !== 'string' || typeof c.cell !== 'string') continue;
    out.push({
      nodeName: c.nodeName,
      cell: c.cell,
      // Молчащий список движков это не «движков нет»: строка скажет об этом
      // своими словами, а выдумывать их здесь нечем.
      engines: Array.isArray(c.engines) ? (c.engines as EngineName[]) : [],
    });
  }
  return out;
}

/**
 * Второй отказ той же формы: 409 `LINK_PORT_IN_USE`.
 *
 * Порт ноги назначает сервер (24000 + шаг), и оператор его не выбирает, но
 * занять его может чужой профиль на той же ноде. Отказ называет ноду, номер,
 * ТРАНСПОРТ и профиль: без транспорта строка врала бы половину времени, потому
 * что `24001/udp` и `24001/tcp` это разные сокеты, и занятость одного ничего не
 * говорит о другом.
 *
 * Разбор и правила те же, что у `refusedCells`: вход проверяется первым, `null`
 * значит «отказ не этот», запись без обязательных полей пропускается.
 */
export interface LinkPortConflict {
  nodeName: string;
  port: number;
  transport: string;
  profileName: string;
}

export function refusedLinkPorts(err: unknown): LinkPortConflict[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!res || res.status !== 409) return null;
  const data = res.data as { error?: string; conflicts?: unknown } | undefined;
  if (!data || data.error !== 'LINK_PORT_IN_USE') return null;
  if (!Array.isArray(data.conflicts)) return null;
  const out: LinkPortConflict[] = [];
  for (const raw of data.conflicts) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.nodeName !== 'string' || typeof c.port !== 'number') continue;
    out.push({
      nodeName: c.nodeName,
      port: c.port,
      // Транспорт и имя профиля идут в текст строки. Пустая строка лучше
      // выдуманной: подпись сама скажет «профиль не назван».
      transport: typeof c.transport === 'string' ? c.transport : '',
      profileName: typeof c.profileName === 'string' ? c.profileName : '',
    });
  }
  return out;
}

/**
 * На чём едет нога (фаза 8, d94b2b2): `direct` или внутри туннеля AmneziaWG.
 *
 * Туннель поднимают ОБЕ стороны ноги, поэтому смотрятся ноды обоих концов
 * через `nodeCoreFit(node, 'amneziawg')`, тем же чтением, что у гейта BACK:
 *
 *   missing  нода сообщила AWG как не установленный. `awg` не предлагается,
 *            причина и ссылка на «Ядра» этой ноды; уже выбранный `awg`
 *            снимается (напрямую доступно всегда);
 *   silent   нода AWG не сообщала вовсе: не отказ, неполный факт фактом не
 *            считается, но экран говорит словами, что проверить нечем.
 *
 * `own` это ключ этой ноги; нет ключа = direct у позиции, у направления
 * значение последней позиции (`inherited`), как у ячейки.
 */
export interface UnderlayFacts {
  value: LinkUnderlay;
  /** Направление без своего ключа идёт как последняя позиция. */
  inherited: boolean;
  missing: { id: string; name: string }[];
  silent: string[];
}

export function underlayFacts(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, Node>,
  own: LinkUnderlay | undefined,
  inherited?: LinkUnderlay,
): UnderlayFacts {
  const missing: { id: string; name: string }[] = [];
  const silent: string[] = [];
  for (const id of new Set(nodeIds.filter(Boolean))) {
    const n = nodeById.get(id);
    if (!n) continue;
    const fit = nodeCoreFit(n, 'amneziawg');
    if (fit.kind === 'missing') missing.push({ id: n.id, name: n.name });
    else if (fit.kind === 'silent') silent.push(n.name);
  }
  const value = own ?? inherited ?? DEFAULT_LINK_UNDERLAY;
  return { value, inherited: own === undefined && inherited !== undefined, missing, silent };
}

/**
 * Положение переключателя подложки. `inherit` есть только у направления в
 * каскаде с несколькими ногами: «как у последней позиции», то есть ключа
 * `underlay` у направления НЕТ. До E25 (стенд 24.09) третьего положения не
 * было: щелчок по строке направления писал ему явный `underlay`, и вернуть
 * «как у позиции» было нечем, а явный `direct` у направления побеждает `awg`
 * позиции.
 */
export type UnderlayChoice = LinkUnderlay | 'inherit';

/**
 * Где стоит переключатель:
 *   position   нога позиции, два положения, нет ключа = direct;
 *   direction  нога до выхода в каскаде из нескольких ног, три положения;
 *   one-leg    каскад из одной ноги (одна позиция, одно направление): нога
 *              одна, и спрашивается она один раз, у направления, два
 *              положения по действующему значению.
 */
export type UnderlayPlace = 'position' | 'direction' | 'one-leg';

/** Одна позиция и одно направление за ней: нога в каскаде одна. */
export function isOneLegCascade(poolCount: number, directionCount: number): boolean {
  return poolCount === 1 && directionCount === 1;
}

/** Что строке ноги нужно про подложку: факты и отказ сервера по её нодам. */
export interface LegUnderlay {
  facts: UnderlayFacts;
  /** Имена нод ЭТОЙ ноги из 409 LINK_UNDERLAY_NOT_ON_NODE. */
  refused: string[];
  place: UnderlayPlace;
  /** Что показывает переключатель: у направления без ключа `inherit`, у
   *  остальных действующее значение. */
  choice: UnderlayChoice;
  onChange: (value: UnderlayChoice) => void;
}

/**
 * Подложка одной ноги для строки: факты по нодам обоих концов и та часть
 * отказа сервера, что называет эти ноды (у ног отказ общий на весь каскад).
 */
export function legUnderlay(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, Node>,
  own: LinkUnderlay | undefined,
  inherited: LinkUnderlay | undefined,
  refusedNames: readonly string[],
  onChange: (value: UnderlayChoice) => void,
  place: UnderlayPlace = 'position',
): LegUnderlay {
  const names = new Set(nodeIds.map((id) => nodeById.get(id)?.name).filter((n): n is string => Boolean(n)));
  const facts = underlayFacts(nodeIds, nodeById, own, inherited);
  return {
    facts,
    refused: refusedNames.filter((n) => names.has(n)),
    place,
    choice: place === 'direction' ? (own ?? 'inherit') : facts.value,
    onChange,
  };
}

/**
 * `linkParams` ноги после выбора подложки. Колонка одна и заменяется целиком,
 * поэтому остальные ключи (congestion) переносятся; `inherit` УБИРАЕТ ключ
 * `underlay`, а не пишет `direct`. Пустой объект уходит как `null`: сервер
 * читает их одинаково, а `null` честно говорит «ничего не выбрано».
 */
export function withUnderlay(params: LinkParams | null | undefined, choice: UnderlayChoice): LinkParams | null {
  const next: LinkParams = { ...(params ?? {}) };
  if (choice === 'inherit') delete next.underlay;
  else next.underlay = choice;
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * 409 `LINK_UNDERLAY_NOT_ON_NODE`: ноды, у которых AWG не установлен, а нога
 * над ними просит туннель. Вход проверяется первым, `null` значит «отказ не
 * этот»; нечитаемые имена пропускаются.
 */
export function refusedUnderlay(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!res || res.status !== 409) return null;
  const data = res.data as { error?: string; nodeNames?: unknown } | undefined;
  if (!data || data.error !== 'LINK_UNDERLAY_NOT_ON_NODE') return null;
  if (!Array.isArray(data.nodeNames)) return [];
  return data.nodeNames.filter((n): n is string => typeof n === 'string' && n !== '');
}

/**
 * Третий отказ той же формы: 409 `ENTRY_CHANGE_DROPS_USERS` (фаза 6).
 *
 * На каскаде один протокол входа. Смена входа с xray на hysteria снимает
 * каскад с xray-профилей входных нод, и их пользователи дальше выходят
 * НАПРЯМУЮ из страны входа. Сервер не молчит об этом, а отказывает и
 * перечисляет, кого это касается; сменить можно, но только повторив запрос с
 * явным согласием (`confirmEntryChange: true`).
 *
 * Разбор тот же, что у двух соседних: вход проверяется первым, `null` значит
 * «отказ не этот», запись без обязательных полей пропускается.
 */
export interface EntryChangeConflict {
  nodeName: string;
  profileName: string;
}

/**
 * Весь вопрос целиком. `from` и `to` называет СЕРВЕР: подпись «с xray на
 * hysteria», собранная по форме, соврала бы, если форму успели поправить ещё
 * раз, пока летел запрос. `null` у них значит «сервер не назвал», и тогда
 * подпись без них, а не с угаданными.
 */
export interface EntryChangeRefusal {
  from: string | null;
  to: string | null;
  conflicts: EntryChangeConflict[];
}

export function refusedEntryChange(err: unknown): EntryChangeRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!res || res.status !== 409) return null;
  const data = res.data as { error?: string; conflicts?: unknown; from?: unknown; to?: unknown } | undefined;
  if (!data || data.error !== 'ENTRY_CHANGE_DROPS_USERS') return null;
  if (!Array.isArray(data.conflicts)) return null;
  const conflicts: EntryChangeConflict[] = [];
  for (const raw of data.conflicts) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.nodeName !== 'string' || typeof c.profileName !== 'string') continue;
    conflicts.push({ nodeName: c.nodeName, profileName: c.profileName });
  }
  return {
    from: typeof data.from === 'string' ? data.from : null,
    to: typeof data.to === 'string' ? data.to : null,
    conflicts,
  };
}

/**
 * Пятый вопрос той же формы: 409 `ENTRY_NODES_DROPPED` (фаза 6).
 *
 * Не смена протокола, а уход НОД из входа: у них есть профили, и их
 * пользователи после сохранения выйдут напрямую. Отдельный код и отдельная
 * подпись («Убрать ноды из входа?»), без `from` и `to`: протокол не меняется.
 * Согласие то же, `confirmEntryChange: true`.
 *
 * Профили группируются ПО НОДЕ: вопрос оператору про ноды, и список «нода:
 * профили» читается как ответ на него, а плоский список пар нет.
 */
export interface EntryNodesDropped {
  nodeName: string;
  profiles: string[];
}

export function refusedEntryNodes(err: unknown): EntryNodesDropped[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!res || res.status !== 409) return null;
  const data = res.data as { error?: string; conflicts?: unknown } | undefined;
  if (!data || data.error !== 'ENTRY_NODES_DROPPED') return null;
  if (!Array.isArray(data.conflicts)) return null;
  const byNode = new Map<string, string[]>();
  for (const raw of data.conflicts) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.nodeName !== 'string' || typeof c.profileName !== 'string') continue;
    const list = byNode.get(c.nodeName) ?? [];
    if (!list.includes(c.profileName)) list.push(c.profileName);
    byNode.set(c.nodeName, list);
  }
  return [...byNode.entries()].map(([nodeName, profiles]) => ({ nodeName, profiles }));
}

/**
 * Можно ли открыть вопрос о согласии, или сервер повторяет уже отвеченный.
 *
 * Сервер задаёт вопросы по очереди (смена протокола, потом уход нод), и после
 * первого согласия за тем же кликом законно приходит второй: это не ошибка, а
 * следующий вопрос. Но тот же вопрос в ответ на запрос, где согласие уже было,
 * это уже ошибка сервера или гонка, и открыть окно снова значило бы крутить
 * оператора по кругу. Поэтому помним коды, на которые в этой цепочке уже
 * согласились.
 */
export function entryQuestionRepeats(code: string, consented: ReadonlySet<string>, sentWithConsent: boolean): boolean {
  return sentWithConsent && consented.has(code);
}

/**
 * Четвёртый отказ той же формы: 409 `ENTRY_CANNOT_CHAIN` (фаза 6).
 *
 * Входные ноды не могут поднять цепь: отчитались о движках, и sing-box среди
 * них нет. Это ФАКТ сервера по отчёту ноды, поэтому кнопку заранее мы им не
 * гасим: частичный или старый список движков годится, чтобы сказать «да», и
 * не годится, чтобы сказать «нет» (правило ворот, 2026-09-11).
 *
 * На сервере этот отказ стоит РАНЬШЕ вопроса о согласии на смену входа:
 * спрашивать «снять ли профили», когда вход всё равно не поднимется, незачем.
 */
export interface EntryChainConflict {
  nodeName: string;
  engines: EngineName[];
}

export function refusedEntryChain(err: unknown): EntryChainConflict[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!res || res.status !== 409) return null;
  const data = res.data as { error?: string; conflicts?: unknown } | undefined;
  if (!data || data.error !== 'ENTRY_CANNOT_CHAIN') return null;
  if (!Array.isArray(data.conflicts)) return null;
  const out: EntryChainConflict[] = [];
  for (const raw of data.conflicts) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.nodeName !== 'string') continue;
    out.push({ nodeName: c.nodeName, engines: Array.isArray(c.engines) ? (c.engines as EngineName[]) : [] });
  }
  return out;
}

/**
 * Пейлоад сохранения с согласием на смену входа или без него.
 *
 * ⚠ Флаг уходит ТОЛЬКО после явного «всё равно сменить». Отдельной функцией,
 * а не полем черновика: черновик живёт между сохранениями, и флаг, однажды
 * попавший туда, уехал бы и со следующим сохранением, уже без вопроса. Здесь
 * он существует ровно на один запрос.
 */
export function withEntryConfirm<T extends object>(
  input: T,
  confirmed: boolean,
): T & { confirmEntryChange?: true } {
  return confirmed ? { ...input, confirmEntryChange: true } : input;
}

/** Занятые порты, относящиеся к ЭТОЙ ноге: та же нода и тот же номер. */
export function legPortNotes(
  nodeIds: string[],
  port: number | null | undefined,
  nodeById: Map<string, { name: string }>,
  conflicts: LinkPortConflict[],
): LinkPortConflict[] {
  if (port === null || port === undefined || conflicts.length === 0) return [];
  const names = new Set(
    nodeIds.map((id) => nodeById.get(id)?.name).filter((n): n is string => Boolean(n)),
  );
  return conflicts.filter((c) => c.port === port && names.has(c.nodeName));
}

/**
 * Что показать под одной ногой: предсказание и отказ сервера, сведённые.
 *
 * Одна нода попадает в строку один раз, даже когда про неё сказали оба
 * источника: слова у них одинаковые, и вторая такая же строка выглядела бы как
 * вторая проблема. Предсказание идёт первым, потому что оно уже на экране к
 * моменту, когда приходит отказ.
 */
export function legCellNotes(
  nodeIds: string[],
  cell: string | null | undefined,
  nodeById: Map<string, { name: string; engines?: EngineName[] }>,
  carries: (node: { engines?: EngineName[] } | undefined, cell: string) => boolean | undefined,
  refusals: CellRefusal[],
): CellGap[] {
  const notes = cellGaps(nodeIds, cell, nodeById, carries);
  if (!cell || refusals.length === 0) return notes;
  const seen = new Set(notes.map((n) => n.name));
  const names = new Set(
    nodeIds.map((id) => nodeById.get(id)?.name).filter((n): n is string => Boolean(n)),
  );
  for (const r of refusals) {
    if (r.cell !== cell || !names.has(r.nodeName) || seen.has(r.nodeName)) continue;
    seen.add(r.nodeName);
    // Сервер называет ноду ИМЕНЕМ, id в отказе нет. Ключ строки это имя: в
    // одном каскаде нода встречается один раз, по имени она и опознаётся.
    notes.push({ nodeId: r.nodeName, name: r.nodeName, engines: r.engines });
  }
  return notes;
}

