import type { RoutingPresetId } from '@iceslab/shared';
import { api } from '@/lib/net/client';

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

/** POST /api/api-tokens response, includes the plaintext token ONCE.
 *  Panel never shows it again after this. */
export interface CreatedApiToken extends ApiToken {
  /** Plaintext bearer token, e.g. `icp_AbC123...`. Copy it now. */
  token: string;
}

export async function listApiTokens(): Promise<{ tokens: ApiToken[] }> {
  const { data } = await api.get<{ tokens: ApiToken[] }>('/api/api-tokens');
  return data;
}

export async function createApiToken(input: {
  name: string;
  scopes?: string[];
}): Promise<CreatedApiToken> {
  const { data } = await api.post<CreatedApiToken>('/api/api-tokens', input);
  return data;
}

export async function deleteApiToken(id: string): Promise<void> {
  await api.delete(`/api/api-tokens/${id}`);
}

export interface PublicSettings {
  brandName?: string;
}

/** Full settings dump (admin-only). Includes subscription metadata
 *  (slice S1, Profile-Title / Update-Interval / Support-URL / Announce). */
export interface AdminSettings extends PublicSettings {
  subscriptionProfileTitle?: string | null;
  subscriptionUpdateIntervalHours?: number;
  subscriptionSupportUrl?: string | null;
  subscriptionAnnounceTemplate?: string | null;
  subscriptionRoutingPreset?: RoutingPresetId;
  /** TLS-fragment - split the ClientHello in the Xray JSON format so SNI-DPI
   *  cannot match the handshake. Xray JSON only. */
  subscriptionTlsFragment?: boolean;
  /** R3-b - raw custom xray routing rules. */
  subscriptionCustomRoutingRules?: Record<string, unknown>[] | null;
  /** R3 - operator-defined custom domain lists (direct/proxy/block). */
  subscriptionCustomDomainLists?: {
    direct?: string[];
    proxy?: string[];
    block?: string[];
  } | null;

  // ───── Выдача ─────

  /** Что отдаётся, когда клиент открыл общую ссылку и ничего не выбрал. */
  subscriptionDefaultFormat?: SubscriptionFormat;
  subscriptionLinkShape?: SubscriptionLinkShape;
  /** Слова оператора для состояний, в которых подключиться нельзя. Пусто
   *  означает «взять наш текст», а не «показать пустую строку». */
  subscriptionDeadTexts?: DeadTexts | null;
  /** Хост без схемы. Правится, потому что влияет только на строки, которые
   *  панель ПЕЧАТАЕТ. */
  subscriptionPublicHost?: string | null;
  /** ТОЛЬКО ЧТЕНИЕ. Маршрут регистрируется этим префиксом при старте, поэтому
   *  запись в базу не перенесла бы маршрут: она заставила бы панель
   *  рекламировать адрес, на котором никто не слушает. */
  subscriptionPathPrefix?: string;
  subscriptionPathPrefixSource?: 'env';
  /** ТОЛЬКО ЧТЕНИЕ. Сколько действующих подписок выдано на текущий адрес.
   *  Показывается ДО смены хоста: их ссылки не перепишутся. */
  subscriptionActiveCount?: number;
}

/** Ровно те состояния, для которых оператор может написать свой текст.
 *  `revoked` сюда не входит: отозванная ссылка это другой адрес, а не
 *  состояние подписки, и говорит по ней наш текст. */
export type DeadTextState = 'expired' | 'limited' | 'disabled';

export type SubscriptionFormat = 'plain' | 'xrayjson' | 'xrayjson-array' | 'clash' | 'singbox';

/** Одна строка на сервер против строки на каждый его выход. */
export type SubscriptionLinkShape = 'per-node' | 'per-exit';

export type DeadTexts = Partial<Record<DeadTextState, { ru?: string; en?: string }>>;

/** Что вернула проверка адреса выдачи. `ok` это «панель достучалась», а не
 *  «всё хорошо»: 404 по несуществующему токену тоже ответ, и правильный. */
export interface SubscriptionProbe {
  ok: boolean;
  status: number;
  ms: number;
  tlsExpiresAt: string | null;
  checkedAt: string;
  url: string;
  error?: string;
}

export async function probeSubscriptionAddress(): Promise<SubscriptionProbe> {
  const { data } = await api.post<SubscriptionProbe>('/api/settings/subscription/probe');
  return data;
}

/** Адрес страницы для предпросмотра. Токен случайный, живёт пятнадцать минут и
 *  ведёт на ВЫДУМАННЫЕ данные: ссылка живого подписчика в iframe это его доступ
 *  в истории браузера, в реферере и в логах каждого прокси по дороге. */
export async function getSubscriptionPreviewUrl(
  state?: 'active' | 'expiring' | 'expired' | 'limited' | 'disabled',
  /**
   * Язык, на котором смотрит оператор.
   *
   * Без него предпросмотр всегда строился на языке панели по умолчанию, и
   * человек, правящий русские тексты неактивной подписки при английском
   * умолчании, своей правки в рамке не видел вовсе. Настоящая страница
   * `/sub/:token` параметр принимает давно, предпросмотр научился позже.
   */
  lang?: 'ru' | 'en',
): Promise<{ url: string }> {
  const { data } = await api.get<{ url: string }>('/api/settings/subscription/preview-url', {
    params: { ...(state ? { state } : {}), ...(lang ? { lang } : {}) },
  });
  return data;
}

export interface UpdateSettingsInput {
  brandName?: string;
  subscriptionProfileTitle?: string | null;
  subscriptionUpdateIntervalHours?: number;
  subscriptionSupportUrl?: string | null;
  subscriptionAnnounceTemplate?: string | null;
  subscriptionRoutingPreset?: RoutingPresetId;
  subscriptionTlsFragment?: boolean;
  subscriptionCustomRoutingRules?: Record<string, unknown>[] | null;
  subscriptionCustomDomainLists?: {
    direct?: string[];
    proxy?: string[];
    block?: string[];
  } | null;
  /** Subscription landing-page default language, mirrored from the panel's UI
   *  language (set by the LanguageSwitcher). The /sub page has its own RU/EN
   *  selector that overrides this per visitor. */
  defaultLocale?: 'ru' | 'en';

  // ───── Выдача. Только эти четыре: экран не редактирует ни префикс пути,
  // ни счётчик подписок, и слать их значило бы предлагать серверу принять то,
  // чего человек не менял. ─────

  subscriptionDefaultFormat?: SubscriptionFormat;
  subscriptionLinkShape?: SubscriptionLinkShape;
  subscriptionDeadTexts?: DeadTexts | null;
  subscriptionPublicHost?: string | null;
}

/** Fetch public-flagged settings, no auth required. Used by LoginPage so
 *  the brand title shows correctly before sign-in. */
export async function getPublicSettings(): Promise<PublicSettings> {
  const { data } = await api.get<PublicSettings>('/api/settings/public');
  return data;
}

/** Admin-only, full settings dump. */
export async function getSettings(): Promise<AdminSettings> {
  const { data } = await api.get<AdminSettings>('/api/settings');
  return data;
}

export async function updateSettings(
  input: UpdateSettingsInput,
): Promise<{ ok: boolean; updated: string[] }> {
  const { data } = await api.put<{ ok: boolean; updated: string[] }>(
    '/api/settings',
    input,
  );
  return data;
}

// ───── System / version (ROADMAP D1) ─────

export interface SystemVersion {
  /** Running panel version (backend package.json). */
  current: string;
  /** Latest GitHub release tag, or null when the check couldn't run
   *  (GitHub unreachable, or private repo without GITHUB_TOKEN). */
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  /** Stargazer count for the topbar chip, null when the check couldn't run. */
  stars: number | null;
  checkedAt: string | null;
}

export async function getSystemVersion(): Promise<SystemVersion> {
  const { data } = await api.get<SystemVersion>('/api/system/version');
  return data;
}
