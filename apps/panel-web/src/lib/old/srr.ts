import type { SubscriptionFormat as SharedFormat } from '@iceslab/shared';
import { api } from '@/lib/old/api';

/**
 * Формат, который правило выдаёт клиенту.
 *
 * ⚠ Тот же союз, что у подписки, из контракта. Свой список здесь не знал
 * `xrayjson-array` и `amneziavpn`, хотя `/sub` их отдаёт: правило на них
 * завести было нельзя, и это выглядело как «панель не умеет», а не как
 * разошедшаяся копия.
 */
export type SubscriptionFormat = SharedFormat;

export interface SrrRule {
  id: string;
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority: number;
  enabled: boolean;
  /**
   * A-236 шаг 4 (BACK-2 51e2d152): шаблон, которым обрамляются клиенты
   * правила. `null` = Default. Поля нет (`undefined`) у сервера старше шага 4:
   * это «не знаю», и поле шаблона на экране тогда не рисуется.
   */
  templateName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSrrInput {
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority?: number;
  enabled?: boolean;
  templateName?: string | null;
}

export interface UpdateSrrInput {
  name?: string;
  uaPattern?: string;
  format?: SubscriptionFormat;
  priority?: number;
  enabled?: boolean;
  /** Нет ключа = не правка; `null` = вернуть Default. */
  templateName?: string | null;
}

/**
 * 400 с полем шаблона (srr.routes.ts, 51e2d152): формат шаблонов не берёт
 * (`SRR_TEMPLATE_NOT_FOR_FORMAT`) или шаблона с таким именем у типа нет
 * (`SRR_TEMPLATE_NOT_FOUND`). Вход проверяется первым; код читается только со
 * своим статусом.
 */
export interface SrrTemplateRefusal {
  code: 'SRR_TEMPLATE_NOT_FOR_FORMAT' | 'SRR_TEMPLATE_NOT_FOUND';
  message: string | null;
}

export function srrTemplateRefusal(err: unknown): SrrTemplateRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: unknown }).response;
  if (!res || typeof res !== 'object') return null;
  const { status, data } = res as { status?: unknown; data?: unknown };
  if (status !== 400 || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.error !== 'SRR_TEMPLATE_NOT_FOR_FORMAT' && d.error !== 'SRR_TEMPLATE_NOT_FOUND') return null;
  return { code: d.error, message: typeof d.message === 'string' ? d.message : null };
}

export interface TestSrrResponse {
  /** null when no rule matched. */
  format: SubscriptionFormat | null;
  userAgent: string;
}

export async function listSrrRules(): Promise<{ rules: SrrRule[] }> {
  const { data } = await api.get<{ rules: SrrRule[] }>('/api/srr');
  return data;
}

export async function createSrrRule(input: CreateSrrInput): Promise<SrrRule> {
  const { data } = await api.post<SrrRule>('/api/srr', input);
  return data;
}

export async function updateSrrRule(id: string, input: UpdateSrrInput): Promise<SrrRule> {
  const { data } = await api.put<SrrRule>(`/api/srr/${id}`, input);
  return data;
}

export async function deleteSrrRule(id: string): Promise<void> {
  await api.delete(`/api/srr/${id}`);
}

export async function testSrrRule(userAgent: string): Promise<TestSrrResponse> {
  const { data } = await api.post<TestSrrResponse>('/api/srr/test', { userAgent });
  return data;
}
