import { FORMAT_NAMES, formatDisabledForHost, type Door, type FormatGap, type FormatWhy, type SubscriptionFormat } from '@iceslab/shared';
import { api } from '@/lib/old/api';

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

/**
 * Почему формат не несёт профиль (A-231, BACK ba3fdf5c): `door` это протокол
 * или его слой защиты, `transport` это сеть двери (общая таблица shared).
 * Одна причина на формат, дверь спрашивается первой. `null` у несущего.
 */
export type FormatReason = 'door' | 'transport';

/** Причина «клиент не возит этот транспорт» (A-231), сверх FormatWhy двери. */
export type HostFormatWhy = FormatWhy | 'client-lacks-transport';

/** Ответ GET /api/profiles/:id/formats: несёт ли каждый формат профиль. */
export interface ProfileFormats {
  door: Door;
  formats: {
    format: SubscriptionFormat;
    carried: boolean;
    why: HostFormatWhy;
    /** Нет у сервера старше A-231: причина тогда не названа, а не выдумана. */
    reason?: FormatReason | null;
  }[];
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
  | { format: SubscriptionFormat; state: 'cannot'; why: FormatGap | 'client-lacks-transport'; reason: FormatReason | null };

/**
 * Подпись причины, по которой формат не несёт хост. Record по типу контракта:
 * новая причина в FormatGap роняет сборку здесь, пока у неё нет слов (так
 * молча выпал client-lacks-cipher, когда причины перебирались списком).
 */
const FORMAT_GAP_KEY: Record<FormatGap | 'client-lacks-transport', string> = {
  'client-lacks-protocol': 'hostEdit.formatWhy.client-lacks-protocol',
  'client-lacks-cipher': 'hostEdit.formatWhy.client-lacks-cipher',
  'no-uri-standard': 'hostEdit.formatWhy.no-uri-standard',
  'not-yet': 'hostEdit.formatWhy.not-yet',
  'client-lacks-transport': 'hostEdit.formatWhy.client-lacks-transport',
};

/** Слово для стороны, которая не пускает формат (A-231): дверь или транспорт. */
export function formatReasonKey(reason: FormatReason | null): string | null {
  return reason === 'door' ? 'hostEdit.formatReason.door' : reason === 'transport' ? 'hostEdit.formatReason.transport' : null;
}

/** Ключ подписи причины, или null для причины, которой эта сборка не знает
 *  (сервер новее экрана): её экран называет кодом, но не молчит. */
export function formatGapKey(why: string): string | null {
  return (FORMAT_GAP_KEY as Record<string, string>)[why] ?? null;
}

/**
 * Не несущие форматы по причинам, в порядке первого появления. Причины берутся
 * из строк, а не из списка на экране: какую бы ни прислал сервер, у неё будет
 * своя строка.
 */
export function formatGapGroups(
  rows: readonly HostFormatRow[],
): { why: string; reason: FormatReason | null; formats: SubscriptionFormat[] }[] {
  const groups = new Map<string, { why: string; reason: FormatReason | null; formats: SubscriptionFormat[] }>();
  for (const r of rows) {
    if (r.state !== 'cannot') continue;
    const key = `${r.reason ?? ''}:${r.why}`;
    const g = groups.get(key) ?? { why: r.why, reason: r.reason, formats: [] };
    g.formats.push(r.format);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export interface HostFormatFacts {
  rows: HostFormatRow[];
  /** null без контракта: считать «несётся N» не из чего. */
  counts: { carried: number; total: number; off: number } | null;
}

/**
 * Clash and Mihomo are one format under two names (A-249): the server closes
 * both when either is in the list (`formatDisabledForHost`, shared). The chips
 * read that rule, not the list, so a host off for Clash never shows Mihomo lit.
 */
const CLASH_FAMILY: readonly SubscriptionFormat[] = ['clash', 'mihomo'];

/**
 * A chip click on the host's format list. A Clash-family name turns both off
 * or both on, and both names are written, as the A-249 migration writes them,
 * so the saved list says what the screen shows.
 */
export function toggleHostFormat(disabled: readonly string[], format: SubscriptionFormat): string[] {
  const group: readonly string[] = CLASH_FAMILY.includes(format) ? CLASH_FAMILY : [format];
  const off = formatDisabledForHost(disabled, format);
  const rest = disabled.filter((x) => !group.includes(x));
  return off ? rest : [...rest, ...group];
}

export function hostFormatFacts(formats: ProfileFormats | null, disabled: readonly string[]): HostFormatFacts {
  const isOff = (format: SubscriptionFormat) => formatDisabledForHost(disabled, format);
  if (!formats) {
    return {
      rows: HOST_FORMATS.map((format) => ({ format, state: isOff(format) ? 'off' : 'on' })),
      counts: null,
    };
  }
  const byFormat = new Map(formats.formats.map((f) => [f.format, f] as const));
  const rows: HostFormatRow[] = HOST_FORMATS.map((format) => {
    const f = byFormat.get(format);
    // Формат, про который сервер не сказал (новый в контракте, старый ответ),
    // не выдаём за «не несёт»: неполный факт фактом не считается.
    // Так же «не несёт» без причины: причину не придумываем.
    if (!f || f.carried || f.why === 'native') return { format, state: isOff(format) ? 'off' : 'on' };
    const reason = f.reason === 'door' || f.reason === 'transport' ? f.reason : null;
    return { format, state: 'cannot', why: f.why, reason };
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
