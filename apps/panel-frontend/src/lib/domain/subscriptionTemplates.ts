import { TEMPLATE_FORMATS, TEMPLATE_TYPES as SHARED_TEMPLATE_TYPES } from '@iceslab/shared';
import { api } from '@/lib/net/client';

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
type TemplateType = (typeof SHARED_TEMPLATE_TYPES)[number];

export const TEMPLATE_TYPES: TemplateType[] = [...SHARED_TEMPLATE_TYPES];

/**
 * Какой формат подписки отдаётся шаблоном этого типа.
 *
 * ⚠ Таблица приехала в `@iceslab/shared` 2026-09-22, временный мост снят:
 * теперь обычный именованный импорт, и расхождение ловит сборка.
 *
 * Локальная копия говорила `stash: 'stash'`, и контракт с ней разошёлся:
 * диалектов без `xhttp` и без `vless` у `/sub` пока нет, поэтому `stash` и
 * `clash` обрамляют тот же формат `clash`, что и `mihomo`. Ровно то, ради чего
 * копию и убирали.
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

/** Ответ сухого прогона: что вышло, что сказало ядро и на что жалуется панель. */
export interface TemplateDryRun {
  ok: boolean;
  /** Вывод на синтетических трёх узлах. */
  rendered: string;
  /** Ответ ядра: `sing-box check` или `xray -test`. */
  check: { ok: boolean; message?: string };
  /** «Слот пуст», «группа без узлов» и подобное. Не отказ, но повод спросить. */
  warnings: string[];
}

export interface TemplateImportResult {
  template: SubscriptionTemplate;
  /** Сколько чужих ключей `remnawave:` переписано в наши `iceslab:`. */
  rewrittenKeys: number;
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
  code: 'TEMPLATE_INVALID' | 'TEMPLATE_NAME_TAKEN' | 'TEMPLATE_DEFAULT_PROTECTED';
  message?: string;
  line?: number;
}

export function templateRefusal(err: unknown): TemplateRefusal | null {
  // ⚠ `err` бывает `null`: у react-query это обычное значение «ошибки нет», и
  // читать у него поле значит уронить весь экран на первом же рендере.
  if (!err || typeof err !== 'object') return null;
  const res = (err as {
    response?: { status?: number; data?: { error?: string; message?: string; line?: number } };
  }).response;
  const code = res?.data?.error;
  if (code !== 'TEMPLATE_INVALID' && code !== 'TEMPLATE_NAME_TAKEN' && code !== 'TEMPLATE_DEFAULT_PROTECTED') {
    return null;
  }
  return { code, message: res?.data?.message, line: res?.data?.line };
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
