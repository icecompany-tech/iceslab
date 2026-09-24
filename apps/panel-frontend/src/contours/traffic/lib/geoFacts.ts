import { GEO_UPLOAD_MAX_BYTES, type GeoRolloutPlan, type GeoSet, type GeoUse } from '@/lib/domain/geoSets';

/**
 * Кто ссылается на набор, словами: «политика ноды RU, DNS ноды ru-01». Вид
 * ссылки обязателен: DNS ноды это не политика, и искать её в политиках
 * бесполезно (geo-contract §8.5). Незнакомый вид печатается как пришёл.
 */
export function usesWords(uses: GeoUse[], t: (k: string, o?: Record<string, unknown>) => string): string {
  if (uses.length === 0) return t('geoSets.usesUnnamed');
  return uses
    .map((u) =>
      u.kind === 'node-policy' || u.kind === 'route-policy' || u.kind === 'node-dns'
        ? t(`geoSets.useKind.${u.kind}`, { name: u.name })
        : `${u.kind} ${u.name}`,
    )
    .join(', ');
}

/**
 * Что показать на экране гео-наборов (Ф9.5, geo-contract §5, §7). Разметка
 * отсюда только красит.
 */
export type GeoScreenState = 'unavailable' | 'empty' | 'list';

export interface GeoScreenFacts {
  state: GeoScreenState;
  sets: GeoSet[];
  total: number;
  /** Есть наборы в проверке: экран переспрашивает список, пока не будет итога. */
  anyChecking: boolean;
}

export function geoScreenFacts(input: { sets?: GeoSet[]; notImplemented?: boolean }): GeoScreenFacts {
  const none = { sets: [], total: 0, anyChecking: false };
  if (input.notImplemented) return { state: 'unavailable', ...none };
  const list = input.sets;
  // Ответа ещё нет: это не «пусто».
  if (!list) return { state: 'unavailable', ...none };
  if (list.length === 0) return { state: 'empty', ...none };
  // Битые, потом в проверке, потом проверенные: экран открывают, когда что-то
  // не так. Встроенные среди своих по имени.
  const rank = (s: GeoSet) => (s.status === 'broken' ? 0 : s.status === 'checking' ? 1 : 2);
  const sets = [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { state: 'list', sets, total: list.length, anyChecking: list.some((s) => s.status === 'checking') };
}

/**
 * Статус набора словами. `status` описывает ПОСЛЕДНЮЮ попытку, `current`
 * последнюю проверенную версию, и «битый» распадается на два разных текста:
 *
 *   broken-empty    проверенной версии нет вовсе: разослать нечего;
 *   broken-update   последнее обновление битое, на нодах по-прежнему current;
 *   checking        идёт скачивание или проверка (фоном, ответ был 202);
 *   verified        последняя попытка прошла.
 */
export type GeoSetState = 'checking' | 'verified' | 'broken-empty' | 'broken-update';

export function geoSetState(set: Pick<GeoSet, 'status' | 'current'>): GeoSetState {
  if (set.status === 'checking') return 'checking';
  if (set.status === 'verified') return 'verified';
  return set.current ? 'broken-update' : 'broken-empty';
}

/**
 * Что можно сделать с набором.
 *
 *   refresh      «Обновить сейчас» у ссылки и встроенного: тянет и проверяет
 *                новую версию НА ПАНЕЛИ, на ноды не шлёт;
 *   replaceFile  у загруженного файла «обновить» это загрузить новый файл;
 *   rollout      «Разослать на ноды» есть только при проверенной версии
 *                (сервер иначе 409 GEO_SET_NOT_VERIFIED);
 *   delete       встроенные не удаляются (409 GEO_SET_BUILTIN). На набор
 *                ссылаются правила (`usedByRules > 0`, факт из списка):
 *                кнопка недоступна с подписью «в N правилах», по образцу E28.
 *                Не запрещать по известному факту значило бы делать вид, что
 *                его нет; 409 GEO_SET_IN_USE остаётся для гонки и называет
 *                ссылки поимённо.
 * Пока идёт проверка, трогать источник и удалять нельзя: итог перезапишет.
 */
export interface GeoSetActions {
  refresh: boolean;
  replaceFile: boolean;
  rollout: boolean;
  delete: boolean;
  /** Почему удалить нельзя, когда нельзя по факту. */
  deleteBlocked: 'builtin' | 'used' | 'checking' | null;
}

export function geoSetActions(set: Pick<GeoSet, 'source' | 'status' | 'current' | 'usedByRules'>): GeoSetActions {
  const busy = set.status === 'checking';
  const deleteBlocked =
    set.source.type === 'builtin' ? 'builtin' : set.usedByRules > 0 ? 'used' : busy ? 'checking' : null;
  return {
    refresh: set.source.type !== 'upload' && !busy,
    replaceFile: set.source.type === 'upload' && !busy,
    rollout: set.current !== null,
    delete: deleteBlocked === null,
    deleteBlocked,
  };
}

/**
 * Что требует внимания по гео, одной строкой над списком: битые наборы по
 * именам и сколько нод отстаёт. Ноды считаются по факту карточек
 * (`nodeGeoFacts` = behind), а не суммой `nodes.behind` наборов: одна нода,
 * отстающая по двум наборам, это одна нода.
 */
export function geoAttention(
  sets: Pick<GeoSet, 'name' | 'status'>[],
  nodesBehind: number,
): { broken: string[]; nodesBehind: number } | null {
  const broken = sets.filter((s) => s.status === 'broken').map((s) => s.name);
  return broken.length === 0 && nodesBehind === 0 ? null : { broken, nodesBehind };
}

/**
 * Окно «Разослать на ноды» по плану сервера.
 *
 * Замена `.dat` это рестарт xray с разрывом сессий: окно называет число таких
 * нод и их имена до кнопки. Непустой `breaks` запрещает кнопку (сервер
 * отказал бы 409 GEO_ROLLOUT_BREAKS): правила ссылаются на теги, которых в новой
 * версии нет, и экран называет их.
 */
export interface GeoRolloutFacts {
  version: string;
  /** Ноды, куда что-то уедет. */
  sending: GeoRolloutPlan['nodes'];
  /** Ноды плана, на которых всё уже совпадает. */
  unchanged: number;
  restarts: string[];
  blocked: boolean;
}

export function geoRolloutFacts(plan: GeoRolloutPlan): GeoRolloutFacts {
  const sending = plan.nodes.filter((n) => n.filesToSend.length > 0 || n.from !== plan.version);
  return {
    version: plan.version,
    sending,
    unchanged: plan.nodes.length - sending.length,
    restarts: plan.nodes.filter((n) => n.restartsXray).map((n) => n.name),
    blocked: plan.breaks.length > 0,
  };
}

/** Проверка файла до отправки: потолок как у сервера и агента, 64 МБ. */
export function uploadProblem(file: { size: number } | null): 'none' | 'too-large' | null {
  if (!file) return 'none';
  return file.size > GEO_UPLOAD_MAX_BYTES ? 'too-large' : null;
}

/** Имя набора, как его примет сервер: ^[a-z0-9-]{1,32}$, geosite и geoip заняты. */
export function geoNameProblem(name: string): 'empty' | 'shape' | 'reserved' | null {
  if (name === '') return 'empty';
  if (!/^[a-z0-9-]{1,32}$/.test(name)) return 'shape';
  if (name === 'geosite' || name === 'geoip') return 'reserved';
  return null;
}
