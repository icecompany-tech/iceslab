import { DRY_RUN_WARNING_CODES, type DryRunWarningCode } from '@iceslab/shared';
import {
  TEMPLATE_TYPES,
  type SubscriptionTemplate,
  type TemplateDryRun,
  type TemplateType,
} from '@/lib/old/subscriptionTemplates';

/**
 * Что показать на экране шаблонов, и что оператору разрешено с каждым.
 *
 * Разметка отсюда только красит. Три состояния экрана легко спутать, и каждая
 * подмена дорогая по-своему: «сервер ещё не умеет» вместо «пусто» зовёт
 * оператора создавать шаблон там, где его негде сохранить; «пусто» вместо
 * «сервер ещё не умеет» выглядит как потерянные данные; ошибка вместо обоих
 * зовёт чинить исправное.
 */
export type TemplatesScreenState = 'unavailable' | 'loading' | 'failed' | 'empty' | 'list';

export interface TemplatesScreenFacts {
  state: TemplatesScreenState;
  /** Группы по типу в порядке контракта. Есть только у `list`. */
  groups: { type: TemplateType; templates: SubscriptionTemplate[] }[];
  /** Сколько шаблонов всего: заголовок говорит число, а не «несколько». */
  total: number;
}

export function templatesScreenFacts(input: {
  /** Ответ сервера; `undefined`, пока ответа нет. */
  templates?: SubscriptionTemplate[];
  /** Сервер ответил «такого маршрута нет», то есть фаза 11 не доехала. */
  notImplemented?: boolean;
  /** Запрос упал не 404 (сеть, 5xx): сбой, а не «ещё не выпущено» (A-233 п.d). */
  failed?: boolean;
}): TemplatesScreenFacts {
  if (input.notImplemented) return { state: 'unavailable', groups: [], total: 0 };
  const list = input.templates;
  // Ответа нет: это не «пусто» и не «сервер не умеет». Пока идёт, загрузка;
  // упал не 404, сбой с повтором (A-236, из A-233 п.d).
  if (!list) return { state: input.failed ? 'failed' : 'loading', groups: [], total: 0 };
  if (list.length === 0) return { state: 'empty', groups: [], total: 0 };

  const groups = TEMPLATE_TYPES.map((type) => ({
    type,
    templates: list.filter((x) => x.type === type).sort(compareInGroup),
  })).filter((g) => g.templates.length > 0);

  return { state: 'list', groups, total: list.length };
}

/**
 * Default всегда первым, остальные по имени.
 *
 * Не по дате правки: список читают, чтобы найти шаблон по имени, а не чтобы
 * узнать, что правили последним. Дата стоит в строке и отвечает на второй
 * вопрос, не перемешивая первый.
 */
function compareInGroup(a: SubscriptionTemplate, b: SubscriptionTemplate): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Что можно сделать с этим шаблоном.
 *
 * Правило одно и оно из контракта: имя `Default` зарезервировано. Такой шаблон
 * не удаляется и не переименовывается, зато его можно восстановить из
 * встроенного. Обычный ведёт себя наоборот, и восстанавливать у него нечего.
 */
export interface TemplateActions {
  canRename: boolean;
  canDelete: boolean;
  canRestore: boolean;
  /** Почему удаление недоступно; `null` у обычного шаблона. */
  protectedReason: 'default' | null;
}

export function templateActions(template: Pick<SubscriptionTemplate, 'isDefault'>): TemplateActions {
  if (template.isDefault) {
    return { canRename: false, canDelete: false, canRestore: true, protectedReason: 'default' };
  }
  return { canRename: true, canDelete: true, canRestore: false, protectedReason: null };
}

/**
 * Ответ сухого прогона, разобранный в три плашки экрана.
 *
 * Три разных вопроса, и смешивать их нельзя. `rendered` это что получил бы
 * клиент. `check` это слово ЯДРА, зелёное или красное, и оно решает, можно ли
 * сохранять. `warnings` это жалобы панели («слот пуст», «группа без узлов»):
 * сохранять при них можно, но спросив, потому что шаблон без слота даёт пустую
 * подписку всем сразу.
 */
export interface DryRunFacts {
  rendered: string;
  /** `ok: null`: ядро не запускалось. */
  check: { ok: boolean | null; message: string | null };
  /** `code: null`: сервер старше кодов (строка) или код, которого нет в контракте. */
  warnings: DryRunWarning[];
  /**
   * Итог прогона (A-236 шаг 3, решение ARCH и AUDT 24.10):
   *   checked    ядро приняло, жалоб нет: «проверено ядром»;
   *   unchecked  ничего не отказано, но ядро не запускалось: сохранять можно,
   *              а сказать «ок» нельзя;
   *   refused    ядро отказало или панель жалуется: сохранение закрыто, причина
   *              словами (слова ядра и жалобы).
   */
  verdict: 'checked' | 'unchecked' | 'refused';
  canSave: boolean;
}

/**
 * Что можно делать в редакторе шаблона прямо сейчас.
 *
 * Тип фиксируется при создании и дальше не меняется: он решает каркас, слот
 * вставки и формат ответа, то есть смена типа это не правка шаблона, а другой
 * шаблон. Имя `Default` не редактируется вовсе, а сохранять пустое тело
 * бессмысленно: подписка отдаст пустой конфиг всем, кто попал на это правило.
 */
export interface TemplateEditorFacts {
  /** Новый шаблон: тип ещё выбирается. */
  isNew: boolean;
  canPickType: boolean;
  canRename: boolean;
  /** Кнопка сохранения живая. */
  canSave: boolean;
  /** Почему сохранение недоступно; `null`, когда доступно. */
  blocker: 'name' | 'body' | 'clean' | null;
}

export function templateEditorFacts(input: {
  isNew: boolean;
  isDefault: boolean;
  name: string;
  body: string;
  dirty: boolean;
}): TemplateEditorFacts {
  const base = { isNew: input.isNew, canPickType: input.isNew, canRename: input.isNew || !input.isDefault };
  // Порядок важен: человеку называют ПЕРВОЕ недостающее, а не все сразу, иначе
  // подсказка читается как список претензий, а не как следующий шаг.
  const blocker: TemplateEditorFacts['blocker'] =
    input.name.trim() === '' ? 'name' : input.body.trim() === '' ? 'body' : !input.dirty ? 'clean' : null;
  return { ...base, canSave: blocker === null, blocker };
}

/**
 * Ворота редактора шаблона (A-236, из A-233 п.d). Новый шаблон открывается
 * сразу. Существующий ждёт список: при сбое не открывается пустым, а говорит
 * сбой с повтором; «удалён» только когда список пришёл без него; 404 списка
 * это «ещё не выпущено», как на экране списка.
 */
export type TemplateEditGate = 'ready' | 'loading' | 'failed' | 'gone' | 'unavailable';

export function templateEditGate(
  isNew: boolean,
  q: { data: unknown; isError: boolean },
  notImplemented: boolean,
  found: boolean,
): TemplateEditGate {
  if (isNew) return 'ready';
  if (notImplemented) return 'unavailable';
  if (q.data === undefined || q.data === null) return q.isError ? 'failed' : 'loading';
  return found ? 'ready' : 'gone';
}

/**
 * Что уходит при сохранении (A-236). Новый шаблон целиком; существующий
 * только изменённое, отсутствие ключа на сервере это отсутствие правки. Имя
 * Default не уходит вовсе: оно не меняется. Нечего слать: null.
 */
export function templateSavePatch(
  template: Pick<SubscriptionTemplate, 'name' | 'body' | 'isDefault'> | null,
  name: string,
  body: string,
): { name?: string; body?: string } | null {
  const typed = name.trim();
  if (!template) return { name: typed, body };
  const out: { name?: string; body?: string } = {};
  if (!template.isDefault && typed !== template.name) out.name = typed;
  if (body !== template.body) out.body = body;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Что панель получила из импортированного файла. Чужих служебных ключей
 * панель не узнаёт (решение владельца 25.10): файл из другой панели сначала
 * идёт через `iceslab-migrate templates`, об этом подсказка на экране.
 */
export interface ImportFacts {
  body: string;
  /** Тип, который определил сервер. `null` = не смог, спрашиваем оператора. */
  type: TemplateType | null;
  name: string;
  /** Тип придётся выбрать руками. */
  needsType: boolean;
}

export function importFacts(result: {
  template?: Partial<SubscriptionTemplate> | null;
} | null | undefined): ImportFacts | null {
  if (!result?.template) return null;
  const tpl = result.template;
  const type = tpl.type && TEMPLATE_TYPES.includes(tpl.type) ? tpl.type : null;
  return {
    body: tpl.body ?? '',
    type,
    name: tpl.name ?? '',
    needsType: type === null,
  };
}

export type DryRunWarning = { code: DryRunWarningCode | null; message: string };

/**
 * Одна жалоба прогона, вход первым (BACK-2 20f07677): объект `{ code, message }`
 * или строка старого сервера (фраза без кода). Код вне контракта читается как
 * `null`, а не выбрасывает жалобу; без фразы жалоба пропускается.
 */
export function dryRunWarningOf(w: unknown): DryRunWarning | null {
  if (typeof w === 'string') return { code: null, message: w };
  if (!w || typeof w !== 'object') return null;
  const { code, message } = w as { code?: unknown; message?: unknown };
  if (typeof message !== 'string') return null;
  const known = typeof code === 'string' && (DRY_RUN_WARNING_CODES as readonly string[]).includes(code);
  return { code: known ? (code as DryRunWarningCode) : null, message };
}

/**
 * Сухой прогон сказал, что узлы не попали ни в одну группу: так выглядит файл
 * из другой панели, чьи служебные ключи Iceslab не узнаёт. Рядом с жалобой
 * подсказка про `iceslab-migrate templates`. По коду из контракта, не по
 * фразе; у строки старого сервера кода нет, и подсказки там нет.
 */
const NO_GROUP_CODES: readonly DryRunWarningCode[] = ['NO_GROUP_HOLDS_NODE', 'NO_SELECTOR_HOLDS_NODE'];

export function nodesInNoGroup(warnings: readonly DryRunWarning[]): boolean {
  return warnings.some((w) => w.code !== null && NO_GROUP_CODES.includes(w.code));
}

/**
 * Годится ли показанный прогон для ТЕКУЩЕГО тела.
 *
 * Прогон делается по телу, каким оно было в момент нажатия. Стоит оператору
 * поправить строку, и зелёная плашка над изменённым конфигом начинает врать:
 * она говорит про то, чего на экране уже нет. Поэтому прогон, снятый с другого
 * тела, не показывается вовсе, а не помечается «устарел»: устаревшую зелёную
 * плашку читают как зелёную.
 */
export function dryRunForBody(
  run: TemplateDryRun | null | undefined,
  ranForBody: string | null,
  body: string,
): TemplateDryRun | null {
  if (!run || ranForBody === null) return null;
  return ranForBody === body ? run : null;
}

/**
 * Save with the run first (A-236 tail, AUDT on f604fb58). Without a verdict
 * for this very body the save asks the dry run itself:
 *   refused       nothing is sent, the reason stays at the button;
 *   checked or unchecked   the save goes;
 *   the run did not answer (network, 5xx) or the server has none (404): the
 *                 save goes, said «not checked». An incomplete fact refuses
 *                 nothing.
 * The calls come in, so a test drives it without a network.
 */
/**
 * One save at a time (AUDT on f604fb58): a second press while the run or the
 * save is still going is dropped, not queued, so a double click sends one run
 * and one save. The button is closed too; this holds even between two clicks
 * in one frame, before the closed button is drawn.
 */
export function singleFlight() {
  let busy = false;
  return async function <T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
}

export type SaveAfterRun<T> =
  | { kind: 'saved'; result: T; note: null | 'no-answer' | 'not-here' }
  | { kind: 'refused'; run: TemplateDryRun };

export async function saveAfterRun<T>(calls: {
  /** The run already shown for this body (dryRunForBody), or null. */
  shown: TemplateDryRun | null;
  runDry: () => Promise<TemplateDryRun>;
  save: () => Promise<T>;
  notImplemented: (err: unknown) => boolean;
  /** The fresh run, so the screen shows what the save was decided on. */
  onRun?: (run: TemplateDryRun) => void;
}): Promise<SaveAfterRun<T>> {
  let run = calls.shown;
  let note: null | 'no-answer' | 'not-here' = null;
  if (!run) {
    try {
      run = await calls.runDry();
      calls.onRun?.(run);
    } catch (err) {
      note = calls.notImplemented(err) ? 'not-here' : 'no-answer';
    }
  }
  if (run && dryRunFacts(run)?.verdict === 'refused') return { kind: 'refused', run };
  return { kind: 'saved', result: await calls.save(), note };
}

export function dryRunFacts(run: TemplateDryRun | null | undefined): DryRunFacts | null {
  if (!run) return null;
  const warnings = Array.isArray(run.warnings)
    ? run.warnings.map(dryRunWarningOf).filter((w): w is DryRunWarning => w !== null)
    : [];
  // Только true и false это ответ ядра; null, отсутствие и мусор: не запускалось.
  const checkOk = run.check?.ok === true ? true : run.check?.ok === false ? false : null;
  // Общий итог сервера, если он булев или null; ответ без него (старый сервер)
  // складывается тем же правилом, что у сервера: отказ или жалоба ложны.
  const derived = checkOk === false || warnings.length > 0 ? false : checkOk;
  const overall = run.ok === true || run.ok === false || run.ok === null ? run.ok : derived;
  // Отказ ядра или жалоба главнее «ок» общего итога: на экране не может быть
  // зелёного над словами отказа.
  const verdict = overall === false || derived === false ? 'refused' : overall === true && checkOk === true ? 'checked' : 'unchecked';
  return {
    rendered: typeof run.rendered === 'string' ? run.rendered : '',
    check: { ok: checkOk, message: typeof run.check?.message === 'string' ? run.check.message : null },
    warnings,
    verdict,
    canSave: verdict !== 'refused',
  };
}
