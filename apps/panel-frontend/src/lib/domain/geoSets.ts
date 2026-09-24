import type {
  GeoRolloutPlan,
  GeoSetDto,
  GeoSetKind,
  GeoSetSource,
  GeoSetStatus,
  GeoSetTag,
  GeoSetUse,
  GeoSetVersionDto,
} from '@iceslab/shared';
import { api } from '@/lib/net/client';

/**
 * Гео-наборы: списки доменов и адресов, по которым правила решают, куда пустить
 * трафик (фаза 9, кусок C, issue #42). Типы из контракта `@iceslab/shared`
 * (geo.ts, 5c649b0), описание в `docs/plan/geo-contract.md`.
 *
 * ⚠ Все запросы идут ТОЛЬКО отсюда. Маршрут, которого сервер ещё не знает,
 * отвечает 404 (загрузка файлом до Ф9.1г), и экран говорит «появится».
 */
export type { GeoRolloutPlan, GeoSetKind, GeoSetSource, GeoSetStatus };
/** Набор, как его отдаёт GET /api/geo-sets. */
export type GeoSet = GeoSetDto;
/** Последняя ПРОВЕРЕННАЯ версия, та, что можно разослать. */
export type GeoSetCurrent = GeoSetVersionDto;
/**
 * Кто ссылается на набор. Вид в контракте закрытый, но разбор отказа не
 * выбрасывает запись с незнакомым видом: она печатается как пришла, иначе
 * оператор не узнал бы, где отцепить.
 */
export type GeoUse = Omit<GeoSetUse, 'kind'> & { kind: string };

export interface GeoTags {
  version: string;
  total: number;
  tags: GeoSetTag[];
}

export async function listGeoSets(): Promise<{ geoSets: GeoSet[] }> {
  const { data } = await api.get<{ geoSets: GeoSet[] }>('/api/geo-sets');
  return data;
}

/** Свой набор по ссылке. 202, статус `checking` до итога проверки. */
export async function createGeoSet(input: {
  name: string;
  kind: GeoSetKind;
  source: { type: 'url'; url: string; sha256Source: 'sidecar' | 'manual'; sha256?: string; refreshHours?: number };
}): Promise<GeoSet> {
  const { data } = await api.post<GeoSet>('/api/geo-sets', input);
  return data;
}

export async function uploadGeoSet(input: { file: File; name: string; kind: GeoSetKind }): Promise<GeoSet> {
  const form = new FormData();
  form.append('name', input.name);
  form.append('kind', input.kind);
  form.append('file', input.file);
  const { data } = await api.post<GeoSet>('/api/geo-sets/upload', form);
  return data;
}

/** Новый файл для набора, загруженного файлом. */
export async function replaceGeoSetFile(id: string, file: File): Promise<GeoSet> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.put<GeoSet>(`/api/geo-sets/${id}/file`, form);
  return data;
}

/** «Обновить сейчас»: тянет и проверяет новую версию на панели, на ноды не шлёт. */
export async function refreshGeoSet(id: string): Promise<GeoSet> {
  const { data } = await api.post<GeoSet>(`/api/geo-sets/${id}/refresh`);
  return data;
}

export async function deleteGeoSet(id: string): Promise<void> {
  await api.delete(`/api/geo-sets/${id}`);
}

export async function getGeoTags(id: string, q: string, limit = 20): Promise<GeoTags> {
  const { data } = await api.get<GeoTags>(`/api/geo-sets/${id}/tags`, { params: { q, limit } });
  return data;
}

export async function getGeoRolloutPlan(id: string): Promise<GeoRolloutPlan> {
  const { data } = await api.get<GeoRolloutPlan>(`/api/geo-sets/${id}/rollout-plan`);
  return data;
}

/** «Разослать на ноды»: двигает пины набора на `version` (= current плана). */
export async function rolloutGeoSet(id: string, version: string): Promise<{ nodes: number }> {
  const { data } = await api.post<{ nodes: number }>(`/api/geo-sets/${id}/rollout`, { version });
  return data;
}

/**
 * Отказы сервера, у которых на экране свои слова (geo-contract §5).
 * Вход проверяется первым: `null` это «ошибки нет» у react-query, и читать у
 * него поле нельзя (так экран шаблонов падал белой страницей 2026-09-22).
 */
export type GeoSetRefusal =
  | { code: 'GEO_SET_INVALID'; reason: string | null; message: string | null }
  | { code: 'GEO_SET_NAME_TAKEN' | 'GEO_SET_BUILTIN' | 'GEO_SET_NOT_VERIFIED'; message: string | null }
  | { code: 'GEO_SET_IN_USE'; uses: GeoUse[]; message: string | null }
  | { code: 'GEO_ROLLOUT_STALE'; current: string | null; message: string | null }
  | { code: 'GEO_ROLLOUT_BREAKS'; breaks: { entry: string; uses: GeoUse[] }[]; message: string | null };

function readUses(raw: unknown): GeoUse[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((u) => {
    if (!u || typeof u !== 'object') return [];
    const { kind, id, name } = u as { kind?: unknown; id?: unknown; name?: unknown };
    return typeof kind === 'string' && typeof id === 'string' && typeof name === 'string' ? [{ kind, id, name }] : [];
  });
}

export function geoSetRefusal(err: unknown): GeoSetRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const data = (res as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const message = typeof d.message === 'string' ? d.message : null;
  switch (d.error) {
    case 'GEO_SET_INVALID':
      return { code: 'GEO_SET_INVALID', reason: typeof d.reason === 'string' ? d.reason : null, message };
    case 'GEO_SET_NAME_TAKEN':
    case 'GEO_SET_BUILTIN':
    case 'GEO_SET_NOT_VERIFIED':
      return { code: d.error, message };
    case 'GEO_SET_IN_USE':
      return { code: 'GEO_SET_IN_USE', uses: readUses(d.uses), message };
    case 'GEO_ROLLOUT_STALE':
      return { code: 'GEO_ROLLOUT_STALE', current: typeof d.current === 'string' ? d.current : null, message };
    case 'GEO_ROLLOUT_BREAKS':
      return {
        code: 'GEO_ROLLOUT_BREAKS',
        breaks: Array.isArray(d.breaks)
          ? d.breaks.flatMap((b) =>
              b && typeof b === 'object' && typeof (b as { entry?: unknown }).entry === 'string'
                ? [{ entry: (b as { entry: string }).entry, uses: readUses((b as { uses?: unknown }).uses) }]
                : [],
            )
          : [],
        message,
      };
    default:
      return null;
  }
}

/** Ответил ли сервер «такого маршрута нет», то есть фаза 9 не доехала. */
export function isNotImplemented(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const res = (err as { response?: unknown }).response;
  return !!res && typeof res === 'object' && (res as { status?: unknown }).status === 404;
}

/* ───── Гео на ноде: намерение против факта (geo-contract §4) ───── */

/** Факт с heartbeat. `null` = нода не сообщила. */
export interface NodeGeoFact {
  version: string | null;
  files: { name: string; sha256: string }[];
  observedAt: string;
}

/** Намерение из пинов ноды и её правил. `null` = правила не ссылаются ни на один набор. */
export interface NodeGeoIntended {
  version: string;
  files: { name: string; sha256: string; setId: string; setName: string; setVersion: string }[];
}

/**
 * Строка «гео» на карточке ноды. Предупреждение из намерения против факта,
 * отказом не становится.
 *
 *   null         сервер поля `geo` не отдаёт (нет в `fields`): строка молчит;
 *   unused       правила ноды ни на один набор не ссылаются (`geoIntended`
 *                пуст): сравнивать не с чем, и карточка МОЛЧИТ, что бы нода ни
 *                сообщала (geo-contract §4, решение ARCH 24.09: «нода не
 *                сообщила» на 31 карточке из 32 на dev было шумом);
 *   unreported   `geo: null` при непустом намерении: нода не сообщила;
 *   same         sha каждого нужного файла совпал с тем, что на диске;
 *   behind       каких наборов файлы не совпали или их нет, по именам наборов.
 *
 * Сравнение по sha файла, не по `version`: версия это подпись, файл на диске
 * это факт (агент отдаёт фактический sha, а не эхо пуша).
 */
export type NodeGeoFacts =
  | { state: 'unreported' }
  | { state: 'unused'; version: string | null }
  | { state: 'same'; version: string }
  | { state: 'behind'; sets: string[] }
  | null;

export function nodeGeoFacts(
  node: { geo?: NodeGeoFact | null; geoIntended?: NodeGeoIntended | null },
  geoKnown: boolean,
): NodeGeoFacts {
  if (!geoKnown || node.geo === undefined) return null;
  const intended = node.geoIntended;
  if (!intended || intended.files.length === 0) return { state: 'unused', version: node.geo?.version ?? null };
  if (node.geo === null) return { state: 'unreported' };
  const onDisk = new Map((node.geo.files ?? []).map((f) => [f.name, f.sha256] as const));
  const behind = [
    ...new Set(intended.files.filter((f) => onDisk.get(f.name) !== f.sha256).map((f) => f.setName)),
  ];
  if (behind.length > 0) return { state: 'behind', sets: behind };
  return { state: 'same', version: intended.version };
}
