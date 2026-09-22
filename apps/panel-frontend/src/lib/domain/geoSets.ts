import { api } from '@/lib/net/client';

/**
 * Гео-наборы: списки доменов и адресов, по которым правила решают, куда пустить
 * трафик (фаза 9, кусок C, issue #42).
 *
 * ⚠ Все запросы идут ТОЛЬКО отсюда. До бэкенда фазы 9 сервер отвечает 404, и
 * экран показывает заглушку «появится с фазой 9», а не ошибку: замена заглушки
 * на живые данные должна быть одной точкой.
 */
export type GeoSetKind = 'geosite' | 'geoip';

export type GeoSetSource =
  | { type: 'builtin'; tag: string }
  | { type: 'url'; url: string }
  | { type: 'upload'; filename: string };

export interface GeoSet {
  id: string;
  name: string;
  kind: GeoSetKind;
  source: GeoSetSource;
  /** Тег выпуска или первые 12 знаков sha256: человеку это «какой файл». */
  version: string;
  sha256: string;
  /** Когда файл забрала ПАНЕЛЬ. С раскладкой по нодам читается парой. */
  fetchedAt: string;
  status: 'ready' | 'fetching' | 'invalid';
  /** Почему `invalid`, словами ядра. */
  error?: string;
}

/** Что реально лежит на каждой ноде, по словам самих нод. */
export interface GeoRolloutNode {
  nodeId: string;
  /** `null` = нода про гео-набор ничего не сообщила. */
  version: string | null;
  /** Когда нода применила то, что у неё лежит. `null` = не сообщала. */
  appliedAt: string | null;
}

export async function listGeoSets(): Promise<{ sets: GeoSet[] }> {
  const { data } = await api.get<{ sets: GeoSet[] }>('/api/geo-sets');
  return data;
}

export async function createGeoSet(input: {
  name: string;
  kind: GeoSetKind;
  source: GeoSetSource;
}): Promise<GeoSet> {
  const { data } = await api.post<GeoSet>('/api/geo-sets', input);
  return data;
}

/** Перечитать источник. Есть смысл только у `url` и `builtin`: загруженный
 *  файл обновляют новой загрузкой. */
export async function refreshGeoSet(id: string): Promise<GeoSet> {
  const { data } = await api.post<GeoSet>(`/api/geo-sets/${id}/refresh`);
  return data;
}

export async function uploadGeoSet(input: {
  file: File;
  name: string;
  kind: GeoSetKind;
}): Promise<GeoSet> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('name', input.name);
  form.append('kind', input.kind);
  const { data } = await api.post<GeoSet>('/api/geo-sets/upload', form);
  return data;
}

export async function deleteGeoSet(id: string): Promise<void> {
  await api.delete(`/api/geo-sets/${id}`);
}

export async function getGeoRollout(): Promise<{ nodes: GeoRolloutNode[] }> {
  const { data } = await api.get<{ nodes: GeoRolloutNode[] }>('/api/geo-sets/rollout');
  return data;
}

/**
 * Отказы сервера, у которых на экране свои слова.
 *
 * `GEO_SET_IN_USE` несёт имена политик: без них оператору сказано «нельзя», но
 * не сказано, где отцепить, и он идёт искать сам по всем правилам.
 */
export interface GeoSetRefusal {
  code: 'GEO_SET_INVALID' | 'GEO_SET_NAME_TAKEN' | 'GEO_SET_IN_USE';
  message?: string;
  /** Политики, которые держат набор. Только у `GEO_SET_IN_USE`. */
  policies?: string[];
}

export function geoSetRefusal(err: unknown): GeoSetRefusal | null {
  // `null` это «ошибки нет» у react-query, и читать у него поле нельзя: ровно
  // так экран шаблонов падал белой страницей 2026-09-22.
  if (!err || typeof err !== 'object') return null;
  const res = (err as {
    response?: { data?: { error?: string; message?: string; policies?: string[] } };
  }).response;
  const code = res?.data?.error;
  if (code !== 'GEO_SET_INVALID' && code !== 'GEO_SET_NAME_TAKEN' && code !== 'GEO_SET_IN_USE') {
    return null;
  }
  return { code, message: res?.data?.message, policies: res?.data?.policies };
}

/** Ответил ли сервер «такого маршрута нет», то есть фаза 9 не доехала. */
export function isNotImplemented(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { response?: { status?: number } }).response?.status === 404;
}
