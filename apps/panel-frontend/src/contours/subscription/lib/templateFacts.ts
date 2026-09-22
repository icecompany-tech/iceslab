import {
  TEMPLATE_TYPES,
  type SubscriptionTemplate,
  type TemplateDryRun,
  type TemplateType,
} from '@/lib/domain/subscriptionTemplates';

/**
 * Что показать на экране шаблонов, и что оператору разрешено с каждым.
 *
 * Разметка отсюда только красит. Три состояния экрана легко спутать, и каждая
 * подмена дорогая по-своему: «сервер ещё не умеет» вместо «пусто» зовёт
 * оператора создавать шаблон там, где его негде сохранить; «пусто» вместо
 * «сервер ещё не умеет» выглядит как потерянные данные; ошибка вместо обоих
 * зовёт чинить исправное.
 */
export type TemplatesScreenState = 'unavailable' | 'empty' | 'list';

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
}): TemplatesScreenFacts {
  if (input.notImplemented) return { state: 'unavailable', groups: [], total: 0 };
  const list = input.templates;
  // Ответа ещё нет: это не «пусто». Экран в этот момент показывает загрузку, и
  // сказать «шаблонов нет» значило бы соврать на полсекунды каждому открытию.
  if (!list) return { state: 'unavailable', groups: [], total: 0 };
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
  check: { ok: boolean; message: string | null };
  warnings: string[];
  /** Сохранение разрешено: ядро не возражает. */
  canSave: boolean;
  /** Сохранение разрешено, но спросив: есть жалобы панели. */
  needsConfirm: boolean;
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

export function dryRunFacts(run: TemplateDryRun | null | undefined): DryRunFacts | null {
  if (!run) return null;
  const warnings = run.warnings ?? [];
  const checkOk = run.check?.ok === true;
  return {
    rendered: run.rendered ?? '',
    check: { ok: checkOk, message: run.check?.message ?? null },
    warnings,
    canSave: checkOk,
    needsConfirm: checkOk && warnings.length > 0,
  };
}
