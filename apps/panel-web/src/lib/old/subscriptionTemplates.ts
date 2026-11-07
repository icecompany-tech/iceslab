import { TEMPLATE_FORMATS, TEMPLATE_TYPES } from '@iceslab/shared';
import type { TemplateType } from '@iceslab/shared';
import { api } from '@/lib/old/api';

/**
 * Шаблоны выдачи: целый клиентский конфиг оператора, в который панель
 * вставляет серверы (фаза 11, план `docs/plan/subscription-templates.md`).
 *
 * ⚠ Все запросы идут ТОЛЬКО отсюда. До бэкенда фазы 11 сервер отвечает на них
 * 404, и экран показывает заглушку «появится с фазой 11», а не ошибку: замена
 * заглушки на живые данные должна быть одной точкой, а не правкой каждого
 * места, которое умеет спросить.
 */
export type { TemplateType } from '@iceslab/shared';

/** Реэкспорт, а не копия: список типов один и живёт в контракте. Массив
 *  приходит `readonly`, и место, которому нужен изменяемый (данные селектора),
 *  копирует его у себя. */
export { TEMPLATE_TYPES };

/**
 * Какой формат подписки отдаётся шаблоном этого типа.
 *
 * ⚠ Таблица приехала в `@iceslab/shared` 2026-09-22, временный мост снят:
 * теперь обычный именованный импорт, и расхождение ловит сборка.
 *
 * С шага 4 A-236 (BACK-2 51e2d152) клеш-семейство по ядру: `mihomo`
 * обрамляет `mihomo`, `stash` свой `stash`, тип `clash` старое ядро
 * `clash-legacy`. Адрес `clash` остался псевдонимом mihomo.
 */
export function templateFormat(type: TemplateType): string {
  return TEMPLATE_FORMATS[type];
}

/** Тело шаблона это YAML или JSON, и от этого зависит подсветка и разбор. */
export function templateBodyLanguage(type: TemplateType): 'yaml' | 'json' {
  return type === 'mihomo' || type === 'stash' || type === 'clash' ? 'yaml' : 'json';
}

export interface SubscriptionTemplate {
  id: string;
  type: TemplateType;
  name: string;
  body: string;
  /**
   * Встроенный шаблон типа. Имя `Default` зарезервировано: такой шаблон не
   * удаляется и не переименовывается, но его можно восстановить кнопкой.
   */
  isDefault: boolean;
  updatedAt: string;
}

/**
 * Ответ сухого прогона (A-236 шаг 3, BACK-2 09326d9a): что вышло, что сказало
 * ядро и на что жалуется панель. `null` у `check.ok` и у общего `ok` значит
 * «ядро не запускалось» (на панели нет бинаря, у Clash ядра нет вовсе): это
 * не «да». Общий `ok` ложен при отказе ядра или любой жалобе панели.
 */
export interface TemplateDryRun {
  ok: boolean | null;
  /** Вывод на синтетических трёх узлах. */
  rendered: string;
  /** Ответ ядра: `sing-box check` или `xray -test`. */
  check: { ok: boolean | null; message?: string };
  /**
   * «Слот пуст», «группа без узлов» и подобное. Не отказ, но повод спросить.
   * С BACK-2 20f07677 объект с кодом из `DRY_RUN_WARNING_CODES` (shared) и
   * фразой; сервер старше отвечает строкой. Разбор `dryRunFacts` принимает оба.
   */
  warnings: ({ code: string; message: string } | string)[];
}

/**
 * Ответ импорта. Чужие служебные ключи панель не узнаёт и не переписывает
 * (решение владельца 25.10: имени чужой панели в коде нет даже литералом):
 * файл из другой панели сначала идёт через `iceslab-migrate templates`.
 */
export interface TemplateImportResult {
  template: SubscriptionTemplate;
}

export async function listTemplates(): Promise<{ templates: SubscriptionTemplate[] }> {
  const { data } = await api.get<{ templates: SubscriptionTemplate[] }>('/api/subscription-templates');
  return data;
}

export async function createTemplate(input: {
  type: TemplateType;
  name: string;
  body: string;
}): Promise<SubscriptionTemplate> {
  const { data } = await api.post<SubscriptionTemplate>('/api/subscription-templates', input);
  return data;
}

export async function updateTemplate(
  id: string,
  input: { name?: string; body?: string },
): Promise<SubscriptionTemplate> {
  const { data } = await api.put<SubscriptionTemplate>(`/api/subscription-templates/${id}`, input);
  return data;
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.delete(`/api/subscription-templates/${id}`);
}

export async function restoreDefaultTemplate(id: string): Promise<SubscriptionTemplate> {
  const { data } = await api.post<SubscriptionTemplate>(
    `/api/subscription-templates/${id}/restore-default`,
  );
  return data;
}

export async function dryRunTemplate(input: {
  type: TemplateType;
  body: string;
}): Promise<TemplateDryRun> {
  const { data } = await api.post<TemplateDryRun>('/api/subscription-templates/dry-run', input);
  return data;
}

export async function importTemplate(input: {
  body: string;
  type?: TemplateType;
}): Promise<TemplateImportResult> {
  const { data } = await api.post<TemplateImportResult>('/api/subscription-templates/import', input);
  return data;
}

/**
 * Отказы сервера, у которых на экране свои слова.
 *
 * `TEMPLATE_INVALID` несёт позицию строки, когда сервер её знает: без неё
 * оператор ищет ошибку глазами по всему конфигу.
 */
export interface TemplateRefusal {
  code: 'TEMPLATE_INVALID' | 'TEMPLATE_NAME_TAKEN' | 'TEMPLATE_DEFAULT_PROTECTED' | 'TEMPLATE_NOT_DEFAULT';
  message?: string;
  /** TEMPLATE_INVALID: строка и столбец, когда сервер их знает (A-236, 29d1f62c). */
  line?: number;
  column?: number;
}

/** Код и статус, с которым сервер его отдаёт (templates.routes.ts). */
const TEMPLATE_REFUSAL_STATUS: Record<TemplateRefusal['code'], number> = {
  TEMPLATE_INVALID: 400,
  TEMPLATE_NAME_TAKEN: 409,
  TEMPLATE_DEFAULT_PROTECTED: 409,
  TEMPLATE_NOT_DEFAULT: 409,
};

export function templateRefusal(err: unknown): TemplateRefusal | null {
  // ⚠ `err` бывает `null`: у react-query это обычное значение «ошибки нет», и
  // читать у него поле значит уронить весь экран на первом же рендере.
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const code = d.error;
  if (typeof code !== 'string' || !Object.hasOwn(TEMPLATE_REFUSAL_STATUS, code)) return null;
  const c = code as TemplateRefusal['code'];
  if (TEMPLATE_REFUSAL_STATUS[c] !== status) return null;
  const pos = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);
  return {
    code: c,
    message: typeof d.message === 'string' ? d.message : undefined,
    line: pos(d.line),
    column: pos(d.column),
  };
}

/**
 * Ответил ли сервер «такого маршрута нет».
 *
 * Именно 404 отличает «фаза 11 ещё не доехала» от пустого списка и от обрыва
 * связи. Первое это заглушка, второе это приглашение создать шаблон, третье
 * это ошибка, и путать их значит либо звать чинить исправное, либо прятать
 * настоящую поломку.
 */
export function isNotImplemented(err: unknown): boolean {
  // `null` это «ошибки нет», и спрашивать у неё статус нельзя: именно так экран
  // и падал белым при первом открытии.
  if (!err || typeof err !== 'object') return false;
  return (err as { response?: { status?: number } }).response?.status === 404;
}
