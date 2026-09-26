import {
  DEFAULT_LINK_CONGESTION,
  DEFAULT_LINK_UNDERLAY,
  LINK_CONGESTIONS,
  LINK_UNDERLAYS,
  type LinkCongestion,
  type LinkUnderlay,
} from '@iceslab/shared';
import { api } from '@/lib/net/client';

export type CascadeProtocol =
  | 'xray' | 'hysteria' | 'amneziawg' | 'naive' | 'shadowsocks' | 'mtproto' | 'mieru';

/** 'chain' (sequential) or 'balancer' (one entry, N latency-balanced exits). */
export type CascadeMode = 'chain' | 'balancer';

/**
 * Ячейка ноги: чем один шаг пути говорит со следующим.
 *
 * Фаза 5 расширяет список с двух до четырёх. `hy2` и `tuic` объявлены здесь
 * ЗАРАНЕЕ, но панель не считает их рабочими, пока сервер не пришлёт таблицу
 * «ячейка -> движки»: имя в союзе это то, что мы умеем разобрать, а не то, что
 * нода умеет поднять. См. `lib/domain/linkCells.ts`.
 */
export type LinkCell = 'vless' | 'shadowsocks' | 'hy2' | 'tuic';

/**
 * Управление перегрузкой у tuic-ноги: список и дефолт КОНТРАКТА, не свои.
 *
 * Список спрошен у движка, а не вычитан со страницы: sing-box 1.13.14 отвечает
 * «unknown congestion control algorithm: brutal» и принимает ровно эти три.
 * Своей копии здесь больше нет: копия расходится молча, потому что СОСТАВ
 * перечисления TypeScript не сторожит по построению. Дефолт приехал оттуда же,
 * и по той же причине: экран печатает им обещание СЕРВЕРА, а обещание,
 * написанное дважды, ещё неделю говорит `bbr` после того, как сервер начал
 * выдавать другое.
 *
 * Имён у этих значений два, и это два СЛОЯ, а не два имени одного:
 * `linkParams.congestion` это наш API оператору, `congestionControl` у
 * пользовательского tuic-инбаунда это зеркало ключа движка. Экран знает только
 * первое. См. шапку `LINK_CONGESTIONS` в `packages/shared/src/transport.ts`.
 */
export { DEFAULT_LINK_CONGESTION, LINK_CONGESTIONS };
export type { LinkCongestion };

/**
 * Настройки ноги сверх выбора ячейки.
 *
 * ⚠ `congestion` есть ТОЛЬКО у tuic. sing-box 1.13.14 отвергает
 * `congestion_control` на hysteria2 при разборе конфига, то есть поле там не
 * игнорируется, а роняет ногу; скорость у hy2 это Brutal, и он задаётся парой
 * чисел про полосу, а не именем алгоритма. Показывать оператору селектор,
 * который положит конфиг на ноде, пока панель пишет «сохранено», нельзя.
 *
 * `obfsPassword` здесь НЕТ намеренно: соль Salamander рождает панель, как и
 * остальные креды линка. Оператор, печатающий её руками, напечатает слабую, и
 * согласовывать её ему не с чем.
 */
export interface LinkParams {
  congestion?: LinkCongestion;
  /**
   * На чём едет нога, фаза 8 (d94b2b2): `direct` через интернет, `awg` внутри
   * туннеля AmneziaWG между двумя нодами. Нет ключа = direct; у направления
   * без ключа берётся значение последней позиции, как у ячейки.
   *
   * ⚠ `linkParams` одна колонка и заменяется ЦЕЛИКОМ: правка congestion без
   * underlay его сотрёт. Поэтому экран мёржит правку в хранимый объект и шлёт
   * его целиком.
   */
  underlay?: LinkUnderlay;
}
export { DEFAULT_LINK_UNDERLAY, LINK_UNDERLAYS };
export type { LinkUnderlay };

export interface CascadeHop {
  id: string;
  nodeId: string;
  nodeName: string;
  position: number;
  entryProtocol: string | null;
  linkProtocol: string | null;
}

/**
 * One step of the path as the API now answers it: a POOL of interchangeable
 * nodes rather than a single machine. Position 0 is the entry.
 */
export interface CascadePosition {
  position: number;
  nodeIds: string[];
  entryProtocol: string | null;
  linkProtocol: string | null;
  /** Настройки ноги этой позиции, фаза 5. Те же три значения, что у
   *  направления: `undefined` это «сервер не отдаёт», `null` это «пусто». */
  linkParams?: LinkParams | null;
}

/**
 * A way out of the cascade. The identity is `id`, not the nodes behind it: the
 * pool can be swapped whole and the direction stays the same direction.
 *
 * ⚠ `tag` is the number that lives inside every client's UUID and gates squad
 * access. The panel issues it and never reuses it, so it is read-only here and
 * must NOT be sent back. What must be sent back is `id` - see
 * CascadeDirectionInput.
 */
export interface CascadeDirection {
  id: string;
  tag: number;
  countryCode: string;
  /** May legitimately be empty: the tag exists, no node stands behind it yet,
   *  and the direction is simply not handed to clients. */
  nodeIds: string[];
  /**
   * Нога до этого выхода, фаза 5.
   *
   * ⚠ ТРИ значения, и первые два разные. `undefined` это «сервер поля ещё не
   * отдаёт», то есть фаза 5 не доехала: экран показывает ногу заблокированной с
   * подписью про фазу 5 и ничего не шлёт. `null` это «поле есть, ячейка не
   * выбрана», и тогда направление идёт ячейкой входа. Прочитать одно как
   * другое значит либо запереть рабочую настройку, либо обещать настройку,
   * которой на сервере нет.
   */
  linkProtocol?: LinkCell | null;
  linkParams?: LinkParams | null;
  /**
   * Порт ноги на ПРИНИМАЮЩЕЙ ноде направления.
   *
   * ⚠ Только чтение: его назначает сервер (24000 + номер последнего шага), и
   * обратно он не отправляется НИКОГДА. `null` пока каскад не сохранён,
   * `undefined` пока сервер поля не отдаёт.
   */
  linkPort?: number | null;
}

export interface Cascade {
  id: string;
  name: string;
  enabled: boolean;
  mode: CascadeMode;
  /** Hide the cascade's non-entry nodes from the raw subscription (default). */
  hideHopsFromSub: boolean;
  /** Offer the Auto line: one profile that names no direction and lets the
   *  entry pick the fastest exit by measured RTT. */
  autoProfile: boolean;
  hops: CascadeHop[];
  /** v4 shape (2026-08-04). Always present; EMPTY means the cascade predates
   *  the move and is still described by `hops`. */
  positions: CascadePosition[];
  directions: CascadeDirection[];
  /**
   * The tag the next new direction will get. Cannot be derived on this side:
   * tags are never reused, so after a direction is deleted `max(tag) + 1` names
   * a number that is already spent. Read it, never compute it.
   */
  nextDirectionTag: number;
  /** AmneziaWG tunnels under the legs (phase 8.3). Absent on a server older
   *  than the field; empty when no leg rides a tunnel. */
  tunnels?: CascadeTunnel[];
  /**
   * Политика входа (Ф9.3, 794441c): одна route-политика для всех, кто входит
   * не xray-ом и политику сам не выбирает (hysteria, позже AWG). Три значения:
   * ключа нет = сервер старше поля, `null` = не задана, объект = задана.
   */
  entryPolicy?: { id: string; name: string; ordinal: number } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One AmneziaWG tunnel under a cascade leg (Ф8.3). Read-only: minted on save
 * from `linkParams.underlay`, re-keyed only by rotateCascadeTunnels. No key
 * travels here.
 */
export interface CascadeTunnel {
  fromNodeId: string;
  toNodeId: string;
  /** `awg-l<n>`, the same on both ends. */
  iface: string;
  /** The /30 and the two inner addresses. */
  network: string;
  fromAddress: string;
  toAddress: string;
  /** UDP, on the receiving end. */
  port: number;
  /** The receiving node's link port stays open to the internet: a leg into it
   *  rides without a tunnel, and a wildcard listener and an inner one cannot
   *  share a port. */
  publicLinkPortOpen: boolean;
}

export interface CascadeHopInput {
  nodeId: string;
  position: number;
  entryProtocol?: CascadeProtocol;
  linkProtocol?: CascadeProtocol;
}

export interface CreateCascadeInput {
  name: string;
  enabled?: boolean;
  mode?: CascadeMode;
  hideHopsFromSub?: boolean;
  hops: CascadeHopInput[];
}

export interface UpdateCascadeInput {
  name?: string;
  enabled?: boolean;
  mode?: CascadeMode;
  hideHopsFromSub?: boolean;
  hops?: CascadeHopInput[];
}

/* ───── Cascades, v4 shape ──────────────────────────────────────────────────
 * The panel describes a cascade as positions and directions rather than hops:
 * a position is a POOL of nodes that all do the same job, and a direction is a
 * way out that owns a tag for good, whatever nodes currently sit under it.
 *
 * The API still speaks the older `hops` shape, so the write below is held
 * behind the flag until it lands. Everything above it (types, form, preview)
 * is already in the new shape, and flipping the flag is the whole migration on
 * this side.
 */

/** One step of the path. Every node in the pool does the same job in parallel. */
export interface CascadePositionInput {
  nodeIds: string[];
  position: number;
  /** Entry only: the core clients dial. */
  entryProtocol?: CascadeProtocol;
  /**
   * ЯЧЕЙКА, которой эта позиция говорит со следующей. У выходной позиции её
   * нет. Строка, а не `CascadeProtocol`: словари ячеек и протоколов нод разные,
   * и совпадали они, пока ячеек было две.
   */
  linkProtocol?: string;
  /**
   * Настройки ноги этой позиции (Ф5.9). Отправляются ТОЛЬКО если оператор их
   * правил: у сервера отсутствие ключа значит «не трогай», `null` значит
   * «сбросить». Правило то же, что у направления.
   */
  linkParams?: LinkParams | null;
}

/**
 * A way out of the cascade, on the way in.
 *
 * ⚠ `id` is what keeps the tag. Send it back for every direction that already
 * exists: a direction that arrives without one is treated as new, gets a fresh
 * tag, and everyone holding a link to the old one silently lands in another
 * country. The API does have a fallback that matches on the node set, but it
 * stops helping exactly when the pool is edited, which is the ordinary case.
 *
 * `tag` is deliberately absent: the panel issues tags and never reuses them, so
 * sending one back could only ever contradict the server.
 */
export interface CascadeDirectionInput {
  /** Omit only for a direction being created right now. */
  id?: string;
  countryCode: string;
  nodeIds: string[];
  /**
   * Нога направления. Отправляются ТОЛЬКО если оператор их правил.
   *
   * Правило то же, что стоило подписки в инциденте 2026-07-31: экран не шлёт
   * список или настройку, которую не редактировал. Здесь это особенно дёшево
   * сломать, потому что до фазы 5 полей нет вовсе, и отправленный `null`
   * означал бы «сбросить ячейку», а не «я про неё ничего не знаю».
   *
   * `linkPort` здесь отсутствует намеренно: его назначает сервер.
   */
  linkProtocol?: LinkCell | null;
  linkParams?: LinkParams | null;
}

export interface CreateCascadeV4Input {
  name: string;
  enabled?: boolean;
  hideHopsFromSub?: boolean;
  autoProfile?: boolean;
  positions: CascadePositionInput[];
  directions: CascadeDirectionInput[];
  /**
   * Политика входа. Create: отсутствие = нет. Update: отсутствие = не править,
   * `null` = снять, id = поставить. Уходит только если оператор её правил.
   */
  entryPolicyId?: string | null;
}

/**
 * Storage moved to positions and directions on 2026-08-04, so the two shapes
 * the screens used to block, a pool of several nodes on one step and transits
 * combined with several directions, are now ordinary saves. What remains is a
 * cap on the total number of node-to-node links, which the forms still count
 * themselves because pools multiply it.
 */
export const CASCADE_V4_WRITES_LIVE = true;

export type UpdateCascadeV4Input = Partial<CreateCascadeV4Input> & {
  /**
   * Согласие на смену входа, которая снимает каскад с профилей входных нод
   * (фаза 6, ответ 409 `ENTRY_CHANGE_DROPS_USERS`). Только `true` и только
   * после явного подтверждения оператором; по умолчанию ключа нет вовсе.
   */
  confirmEntryChange?: true;
};

/** The API's own sentence when it refuses a shape it cannot store. */
export function cascadeShapeError(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
  if (res?.status !== 400) return null;
  return res.data?.message ?? null;
}

export async function createCascadeV4(input: CreateCascadeV4Input): Promise<Cascade> {
  const { data } = await api.post<Cascade>('/api/cascades', input);
  return data;
}

export async function updateCascadeV4(id: string, input: UpdateCascadeV4Input): Promise<Cascade> {
  const { data } = await api.put<Cascade>(`/api/cascades/${id}`, input);
  return data;
}

/**
 * Список каскадов. `fields`: имена необязательных ключей DTO, которые сервер
 * отдаёт (CASCADE_DTO_FIELDS, Ф9.3), по образцу нод (E29). Отвечает на «знает
 * ли сервер поле» и при пустом списке каскадов.
 */
export async function listCascades(): Promise<{ cascades: Cascade[]; fields?: string[] }> {
  const { data } = await api.get<{ cascades: Cascade[]; fields?: string[] }>('/api/cascades');
  return data;
}

export async function createCascade(input: CreateCascadeInput): Promise<Cascade> {
  const { data } = await api.post<Cascade>('/api/cascades', input);
  return data;
}

export async function updateCascade(id: string, input: UpdateCascadeInput): Promise<Cascade> {
  const { data } = await api.put<Cascade>(`/api/cascades/${id}`, input);
  return data;
}

export interface CascadeHopStatus {
  nodeId: string;
  name: string;
  /** The node acknowledged an inbound push made after this cascade was saved. */
  applied: boolean;
  online: boolean;
  /** Почему хоп не несёт каскад, словами агента (E46, 3962886), null = не
   *  сломан. Нет ключа: сервер старше поля. */
  broken?: string | null;
}

export interface CascadeStatus {
  /** С E46 false при любом broken. */
  done: boolean;
  /** Первый сломанный хоп одной фразой «<нода>: <причина>», null = нет. */
  broken?: string | null;
  hops: CascadeHopStatus[];
}

/** Provisioning state of a cascade's hops, polled after a save. */
/**
 * Re-key the AmneziaWG tunnels under the cascade's legs (phase 8.3): one node
 * pair, or every pair when `pair` is absent. Keys and obfuscation are minted
 * afresh; interface, /30 and port stay. Answers the cascade; 404
 * TUNNEL_NOT_FOUND for a pair it no longer has.
 */
export async function rotateCascadeTunnels(
  id: string,
  pair?: { fromNodeId: string; toNodeId: string },
): Promise<Cascade> {
  const { data } = await api.post<Cascade>(`/api/cascades/${id}/tunnels/rotate`, pair ?? {});
  return data;
}

export async function getCascadeStatus(id: string): Promise<CascadeStatus> {
  const { data } = await api.get<CascadeStatus>(`/api/cascades/${id}/status`);
  return data;
}

export async function deleteCascade(id: string): Promise<void> {
  await api.delete(`/api/cascades/${id}`);
}
