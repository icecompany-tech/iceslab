import { FORMAT_NAMES, type Door, type FormatGap, type FormatWhy, type SubscriptionFormat } from '@iceslab/shared';
import { api } from '@/lib/net/client';

/**
 * Форматы подписки, которые можно выключить у хоста.
 *
 * ⚠ Список ОДИН и живёт в контракте. Своя копия на экране хоста стоила
 * issue #41 (внешний репорт 17.08): в ней было имя `xrayjson`, которого схема
 * хостов не знает, и сохранение с ним падало 400. Копия разошлась с сервером
 * молча, потому что разойтись ей было нечем помешать.
 *
 * Подпись берётся ПО ИМЕНИ из локалей: `hostEdit.formatName.<имя>`. Тест рядом
 * следит, что подпись есть у каждого имени из контракта, иначе новый формат
 * появился бы на экране голым идентификатором.
 */
export const HOST_FORMATS: readonly SubscriptionFormat[] = FORMAT_NAMES;

/**
 * Ключ подписи. Словарь ОБЩИЙ (`common.formatName`), а не хостовый: те же
 * имена называют настройка «формат по умолчанию» и правило выдачи, и второй
 * словарь разошёлся бы с первым на первой же правке.
 */
export function formatLabelKey(name: string): string {
  return `formatName.${name}`;
}

export function formatLabel(
  name: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  // Если подписи нет, показываем само имя: голый идентификатор честнее пустой
  // строки, и тест рядом всё равно не даст этому уехать в релиз.
  return t(formatLabelKey(name), { defaultValue: name });
}

/** Ответ GET /api/profiles/:id/formats: несёт ли каждый формат дверь профиля. */
export interface ProfileFormats {
  door: Door;
  formats: { format: SubscriptionFormat; carried: boolean; why: FormatWhy }[];
}

/**
 * Какие форматы несут профиль при этом слое безопасности хоста. `null`, если
 * сервер ответа не дал (старый сервер без маршрута, профиль не найден): экран
 * тогда рисует прежний список ручных выключений.
 */
export async function getProfileFormats(
  profileId: string,
  securityLayer: 'default' | 'tls' | 'none',
): Promise<ProfileFormats | null> {
  try {
    const { data } = await api.get<ProfileFormats>(`/api/profiles/${profileId}/formats`, {
      params: { securityLayer },
    });
    return Array.isArray(data?.formats) ? data : null;
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
    throw err;
  }
}

/**
 * Строка формата на экране хоста, одно из трёх:
 *   on       несёт, оператор не выключал (галочка, можно выключить);
 *   off      несёт, оператор выключил (можно включить);
 *   cannot   не несёт вовсе, с причиной: выключатель тут ничего бы не менял.
 * Без ответа сервера (`formats` null) трёх состояний нет: только on / off,
 * как было до контракта.
 */
export type HostFormatRow =
  | { format: SubscriptionFormat; state: 'on' | 'off' }
  | { format: SubscriptionFormat; state: 'cannot'; why: FormatGap };

export interface HostFormatFacts {
  rows: HostFormatRow[];
  /** null без контракта: считать «несётся N» не из чего. */
  counts: { carried: number; total: number; off: number } | null;
}

export function hostFormatFacts(formats: ProfileFormats | null, disabled: readonly string[]): HostFormatFacts {
  if (!formats) {
    return {
      rows: HOST_FORMATS.map((format) => ({ format, state: disabled.includes(format) ? 'off' : 'on' })),
      counts: null,
    };
  }
  const byFormat = new Map(formats.formats.map((f) => [f.format, f] as const));
  const rows: HostFormatRow[] = HOST_FORMATS.map((format) => {
    const f = byFormat.get(format);
    // Формат, про который сервер не сказал (новый в контракте, старый ответ),
    // не выдаём за «не несёт»: неполный факт фактом не считается.
    // Так же «не несёт» без причины: причину не придумываем.
    if (!f || f.carried || f.why === 'native') return { format, state: disabled.includes(format) ? 'off' : 'on' };
    return { format, state: 'cannot', why: f.why };
  });
  return {
    rows,
    counts: {
      carried: rows.filter((r) => r.state === 'on').length,
      total: rows.length,
      off: rows.filter((r) => r.state === 'off').length,
    },
  };
}
