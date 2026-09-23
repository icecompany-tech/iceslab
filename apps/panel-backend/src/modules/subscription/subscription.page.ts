// Human-readable HTML landing page for a subscription token.
//
// Wave-14 #6 (issue #1): opening a /sub/<token> link in a BROWSER previously
// fell through to `plain` and dumped raw base64 at the user. VPN clients want
// that; humans want a guided page.
//
// Self-contained: inline CSS + one inline script (platform tabs + copy), no
// external assets, no web fonts (this page is opened on censored networks where
// a Google Fonts CDN can be blocked or slow, so character comes from the system
// stack + a monospace accent, not a downloaded display face). Everything
// interpolated from admin/user input is HTML-escaped (esc).

import {
  PROTOCOL_NAMES,
  formatCarriesAny,
  type ProtocolName,
  type SubscriptionFormat,
} from '@iceslab/shared';
import { PAGE_CSS } from './subscription.page-styles.js';
import { pageScript } from './subscription.page-script.js';
import { QR_SCRIPT, qrBox } from './subscription.page-qr.js';
import { L, type Labels, type StepText } from './subscription.page-text.js';
import {
  APPS,
  PLATFORM_GLYPH,
  PLATFORM_LABEL,
  PLATFORM_ORDER,
  deeplinkHref,
  type AppDef,
  type PlatformId,
} from './subscription.page-apps.js';
import {
  APP_MARK,
  GLYPHS,
  createGlyphSheet,
  type Glyph,
  type GlyphKey,
  type GlyphSheet,
} from './subscription.page-icons.js';

export interface SubscriptionPageData {
  brandTitle: string;
  lang: 'ru' | 'en';
  subUrl: string;
  supportUrl: string | null;
  user: {
    username: string;
    status: string;
    expireAt: string | null;
    trafficLimitBytes: number | null;
    trafficUsedBytes: number;
  };
  /** Distinct protocols present in this subscription. */
  protocols: ProtocolName[];
  /**
   * Что оператор написал своими словами для состояний, в которых подключиться
   * нельзя. Пусто, пробелы или отсутствие ключа означают «оставить наш текст»,
   * а не «показать пустую строку»: человек, читающий эту страницу, уже не может
   * подключиться, и отнять у него ещё и объяснение было бы худшим из исходов.
   *
   * `revoked` сюда не входит намеренно: отозванная ссылка это не состояние
   * подписки, а другой адрес, и говорить по нему должен наш текст.
   */
  deadTexts?: {
    expired?: { ru?: string; en?: string };
    limited?: { ru?: string; en?: string };
    disabled?: { ru?: string; en?: string };
  } | null;
  /**
   * One entry per AmneziaWG node, each with the two PAYLOADS a code is drawn
   * from: the AmneziaVPN "vpn://" key and the native .conf. Single-tunnel-per-
   * key, so a user with several AWG servers gets one labelled pair per server
   * instead of only the first node's.
   *
   * The payloads, not pictures of them: the codes are drawn in the browser
   * (subscription.page-qr.ts), which costs one encoder instead of an SVG per
   * code, and leaves a reader with JavaScript off holding the config itself
   * rather than an empty square.
   */
  awgNodes?: Array<{
    nodeName: string;
    /** The wg-quick config this node hands out. */
    conf?: string;
    /** Raw AmneziaVPN vpn:// key. Also what the copy button hands over, since
     *  the dense key QR is unreliable on screen and paste-the-key is the
     *  robust import path. */
    vpnKey?: string;
  }>;
  /**
   * One entry per MTProto node, with its proxy link already built.
   *
   * MTProto is in no config format at all: not clash, not sing-box, not
   * xray-json, not Surge. So a row here is not a convenience, it is the ONLY
   * way to use such a node from this page, and its absence is what made an
   * MTProto subscription look empty (issue #41).
   *
   * Both forms travel because they are for different places: `tmeUri` is a
   * plain https link that works anywhere and is what a person sends to
   * somebody, `uri` is the `tg://` form that opens the app directly.
   */
  mtprotoNodes?: Array<{ nodeName: string; uri: string; tmeUri: string }>;
  /**
   * The SOCKS5 and HTTP doors for Telegram (23.09), one row per endpoint, with
   * THIS person's login in it. socks carries `tgUri` (tg://socks, opens the
   * add-proxy dialog); http has no link in any Telegram client, so the page
   * spells out the four fields Telegram Desktop asks for.
   */
  telegramProxies?: Array<{
    nodeName: string;
    kind: 'socks' | 'http';
    tgUri?: string;
    host: string;
    port: number;
    username: string;
    password: string;
  }>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * "10 декабря, 2026" / "December 10, 2026".
 *
 * The page used to print `toISOString().slice(0,10)`, which is a machine's
 * date: 2026-12-10 reads as the tenth of December to half the world and as
 * nothing in particular to the other half. Intl is in the runtime, so this
 * needs no dependency and no external anything.
 *
 * Built from parts rather than from a format string because the mockup's
 * comma is not a pattern any locale offers, and because the Russian month has
 * to come out in the genitive ("декабря", not "декабрь"). Asking for day and
 * month together is what gets that case; asking for the month alone does not.
 */
function fmtDate(iso: string, lang: 'ru' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const day = get('day');
  const month = get('month');
  const year = get('year');
  return lang === 'ru' ? `${day} ${month}, ${year}` : `${month} ${day}, ${year}`;
}

/**
 * Russian counts in three forms, and the wrong one is the loudest possible
 * sign that a page was written elsewhere: "осталось 82 дня", "осталось 21
 * день", "осталось 5 дней". English has two.
 */
function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/**
 * Whole days from now to `iso`, rounded UP, so the last day of a subscription
 * reads "1 day" rather than "0". Negative once it has passed.
 */
function daysUntil(iso: string, now = Date.now()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.ceil((t - now) / 86_400_000);
}

function fmtBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ───── Platforms ─────

function platformLabel(p: PlatformId, t: Labels): string {
  return p === 'router' ? t.routerLabel : PLATFORM_LABEL[p];
}

/** Every app this platform can offer THIS subscription, registry order. */
function appsFor(platform: PlatformId, userProtocols: ProtocolName[], hasAwg: boolean): AppDef[] {
  const protoSet = new Set(userProtocols);
  return APPS.filter(
    (a) =>
      a.platforms.includes(platform) &&
      a.protocols.some((p) => protoSet.has(p)) &&
      (a.action.kind === 'deeplink' || a.action.kind === 'manual' ? true : hasAwg),
  );
}

/** How many apps stand in the row above the fold. Four fits the column at 740
 *  and two at phone width; everything else goes under "all apps". */
const ROW_SIZE = 4;

/** Столько карточек в ряду второго уровня. См. комментарий у вызова. */
const ALL_ROW_SIZE = 3;

/**
 * The row is the recommended ones, topped up to ROW_SIZE from the rest.
 *
 * Topping up rather than showing only what carries the flag: on some platforms
 * two apps are flagged and the row would look half-built, and the apps that
 * follow in registry order are the ones we would have named anyway.
 */
function splitApps(apps: AppDef[]): { row: AppDef[]; rest: AppDef[] } {
  const row = apps.filter((a) => a.recommended).slice(0, ROW_SIZE);
  // Top up from the plain clients before the routing consoles: the row is the
  // short answer to "what do I install", and that answer is never v2rayN.
  for (const a of apps) {
    if (row.length >= ROW_SIZE) break;
    if (!a.advanced && !row.includes(a)) row.push(a);
  }
  for (const a of apps) {
    if (row.length >= ROW_SIZE) break;
    if (!row.includes(a)) row.push(a);
  }
  return { row, rest: apps.filter((a) => !row.includes(a)) };
}

/**
 * One app card: name, the app's own mark bleeding off the right edge, and the
 * way in.
 *
 * It is a link, not a button, and that is on purpose while the steps block is
 * not built yet: a card that only highlights itself would leave the reader
 * with nothing to press. The mark is a watermark at the opacity measured for
 * that mark (Happ is nearly solid, Shadowrocket a thin outline), carried in a
 * css variable so the one rule in the stylesheet covers every card.
 */
/**
 * Карточка приложения это ВЫБОР, а не действие.
 *
 * Нажатие раньше сразу дёргало deeplink, и на странице не было состояния
 * «я ставлю вот этот клиент»: шаги под рядом говорили одно и то же про любой
 * из двадцати, а карточка, по которой уже нажали, ничем не отличалась от
 * соседней. Теперь она загорается, а шаги перерисовываются под неё: куда идти
 * за этим приложением и какой кнопкой отдать подписку именно ему.
 *
 * Адреса едут на карточке атрибутами, а не в таблице внутри скрипта: их
 * читает и подставляет один обработчик, и добавление клиента не требует
 * трогать скрипт.
 */
function renderAppCard(a: AppDef, subUrl: string, icons: GlyphSheet, on = false): string {
  let href: string;
  let glyphKey: GlyphKey;
  switch (a.action.kind) {
    case 'deeplink':
      href = deeplinkHref(a.action.scheme, subUrl);
      glyphKey = 'ExternalLink';
      break;
    case 'awg-vpn':
    case 'awg-conf':
      href = '#scan';
      glyphKey = 'qr';
      break;
    case 'download':
      href = '#downloads';
      glyphKey = 'DownloadIcon';
      break;
    default:
      href = '#sublink';
      glyphKey = 'copy';
      break;
  }
  const markKey = APP_MARK[a.name];
  const ink = markKey ? (GLYPHS[markKey] as Glyph).ink : undefined;
  const mark = markKey
    ? `<span class="app-card__mark">${icons.draw(markKey, { cls: 'mrk-big' })}</span>`
    : '';
  const dot = a.recommended ? '<span class="app-card__dot"></span>' : '';
  // Знак и значок действия занимают ОДИН угол, и когда стоят оба, кубик
  // sing-box лежит под стрелкой, а знак AmneziaVPN под кодом: читается как
  // грязь, а не как две вещи. В макете на карточке с маркой значка нет вовсе,
  // марка и есть опознание. Значок остаётся там, где марки не нашлось: угол
  // свободен, и он единственное, что говорит, чем кончится нажатие.
  const glyph = markKey
    ? ''
    : `<span class="app-card__glyph">${icons.draw(glyphKey, { cls: 'ic' })}</span>`;
  return (
    `<button type="button" class="app-card${on ? ' is-on' : ''}" data-app="${esc(a.name)}"` +
    ` data-app-add="${esc(href)}" data-app-kind="${a.action.kind}"` +
    (a.site ? ` data-app-site="${esc(a.site)}"` : '') +
    `${ink !== undefined ? ` style="--mark-o:${ink}"` : ''}>` +
    `${dot}<span class="app-card__name">${esc(a.name)}</span>${glyph}${mark}</button>`
  );
}

/**
 * Platforms with no way to read a QR code, so no transfer button either.
 *
 * A television and a router have no camera. The code works the other way round
 * from what people expect here: a screen shows it and a PHONE reads it, and
 * what is needed on these is the opposite, getting a link ONTO the device. The
 * steps say to type it instead.
 */
const NO_TRANSFER: PlatformId[] = ['androidtv', 'appletv', 'router'];

/** Platforms whose Telegram app has proxy settings at all. */
const TELEGRAM_PLATFORMS: PlatformId[] = ['ios', 'android', 'windows', 'macos', 'linux'];

/**
 * The Telegram row, which is not an app card and must not look like one.
 *
 * Two conditions, both from the field rather than from the layout:
 *   - the platform. core.telegram.org/proxy says "All Telegram mobile and
 *     desktop apps allow users to connect via a proxy" and names Android, iOS,
 *     Desktop and macOS. The WEB client has no proxy fields at all, and there
 *     is no Telegram on Android TV or tvOS, so the row would be a dead control
 *     on a television and on a router.
 *   - the subscription. This offers OUR telegram proxy, so it appears when the
 *     subscription actually carries one. Drawing it otherwise is the same
 *     defect as naming an app that does not exist on the reader's platform.
 */
function renderTelegramRow(
  platform: PlatformId,
  userProtocols: ProtocolName[],
  t: Labels,
  icons: GlyphSheet,
): string {
  if (!TELEGRAM_PLATFORMS.includes(platform)) return '';
  if (!userProtocols.includes('mtproto')) return '';
  return (
    `<div class="tg-row"><div class="tg-row__col">` +
    `<div class="tg-row__name">${esc(t.telegram)}</div>` +
    `<div class="tg-row__note">${esc(t.telegramNote)}</div></div>` +
    `<span class="tg-row__mark">${icons.draw('Telegram', { cls: 'mrk-big' })}</span></div>`
  );
}

/** Cards in rows of ROW_SIZE, the last row padded so the widths stay equal. */
function cardRows(
  apps: AppDef[],
  subUrl: string,
  icons: GlyphSheet,
  cls: string,
  per: number = ROW_SIZE,
  /** Имя клиента, чья карточка уже выбрана. */
  selected?: string,
): string {
  const rows: string[] = [];
  for (let i = 0; i < apps.length; i += per) {
    const chunk = apps.slice(i, i + per);
    const pad = '<span class="spacer"></span>'.repeat(per - chunk.length);
    rows.push(
      `<div class="${cls}">${chunk.map((a) => renderAppCard(a, subUrl, icons, a.name === selected)).join('')}${pad}</div>`,
    );
  }
  return rows.join('');
}

/**
 * The second level: everything else this platform runs, folded away.
 *
 * Only when there IS an else. A platform offering three clients has no second
 * level, it has a sentence saying that three is the whole list: an empty
 * expander is worse than no expander, and on a television the short list is
 * the answer rather than a sample of one.
 */
function renderAllApps(
  platform: PlatformId,
  apps: AppDef[],
  rest: AppDef[],
  subUrl: string,
  t: Labels,
  icons: GlyphSheet,
): string {
  const label = platformLabel(platform, t);
  if (rest.length === 0) {
    return (
      `<div class="note-strip">${icons.draw('AlertCircle', { cls: 'ic' })}` +
      `<div class="note-strip__text">${esc(t.wholeList.replace('{p}', label))}</div></div>`
    );
  }
  const plain = rest.filter((a) => !a.advanced);
  const advanced = rest.filter((a) => a.advanced);
  const group = (title: string, list: AppDef[]) =>
    list.length === 0
      ? ''
      : `<div class="all-apps__group"><div class="all-apps__group-title">${esc(title)}</div>` +
        // Второй уровень идёт по ТРИ в ряд, а не по четыре, как ряд над ним:
      // карточек тут вдвое больше, имена длиннее («AmneziaVPN», «Quantumult X»),
      // и на четвёртой колонке они обрезались многоточием. В макете ровно так же.
      cardRows(list, subUrl, icons, 'all-apps__row', ALL_ROW_SIZE) +
        `</div>`;
  return `<div class="all-apps" data-all-apps>
      <div class="all-apps__top">
        <div class="all-apps__line">
          <span class="all-apps__title">${esc(t.allApps.replace('{p}', label))}</span>
          <span class="all-apps__count">${apps.length}</span>
          <button class="all-apps__toggle" type="button" data-toggle-all aria-expanded="false">
            <span>${esc(t.showAll)}</span>${icons.draw('chevron', { cls: 'ic ic--sel' })}
          </button>
        </div>
        <div class="all-apps__note">${esc(t.allAppsNote)}</div>
      </div>
      <div class="all-apps__body">
        ${group(t.groupPlain, plain)}${group(t.groupAdvanced, advanced)}
      </div>
    </div>`;
}

/**
 * The numbered steps under the apps.
 *
 * Platform-level, not app-level, and that is a limit rather than a choice: the
 * mockup's steps describe one particular client's screens ("turn on the TUN
 * switch in the bottom right"), and the registry holds no per-app instructions
 * or download URLs. Inventing plausible ones would put unverified claims on a
 * page whose whole job this slice is to make truthful. What is here is true of
 * any client on that platform; the app-specific version needs data, see the
 * handoff report.
 *
 * The television and router wordings come from the mockup as written: those
 * ARE platform facts, and they are the ones a reader cannot work out alone.
 */
function renderSteps(
  platform: PlatformId,
  data: SubscriptionPageData,
  hasAwg: boolean,
  t: Labels,
  icons: GlyphSheet,
  /** Клиент, под который нарисованы кнопки шагов: тот, что загорится первым. */
  first?: AppDef,
): string {
  const step = (
    icon: GlyphKey,
    s: StepText | undefined,
    opts: { tone?: string; box?: string; body?: string } = {},
  ) =>
    s
      ? `<div class="step${opts.box ?? ''}">` +
        `<div class="step__num${opts.tone ?? ''}">${icons.draw(icon, { cls: 'ic' })}</div>` +
        `<div class="step__col"><div class="step__title">${esc(s.title)}</div>` +
        `<div class="step__text">${esc(s.text)}</div>${opts.body ?? ''}</div></div>`
      : '';

  if (platform === 'androidtv' || platform === 'appletv') {
    const s = t.stepsTv;
    // The link, big and selectable, because it is going to be typed by hand:
    // there is no camera on a television and no way to press a button here
    // that opens anything there.
    const field =
      `<div class="step__field"><div class="step__field-label">${esc(t.enterOnTv)}</div>` +
      `<div class="step__field-value">${esc(data.subUrl)}</div></div>`;
    return (
      step('DownloadIcon', s[0]) +
      step('qr', s[1], { box: ' step--highlight', body: field }) +
      step('help', s[2], { tone: ' step__num--info' }) +
      step('Check', s[3], { tone: ' step__num--ok' })
    );
  }

  if (platform === 'router') {
    const s = t.stepsRouter;
    const confs = (data.awgNodes ?? [])
      .map(
        (n) =>
          `<a class="conf-row" href="${esc(data.subUrl)}?format=wgconf&amp;node=${encodeURIComponent(n.nodeName)}">` +
          `<span class="conf-row__name">${esc(n.nodeName)}</span>` +
          `<span class="conf-row__file">awg-${esc(n.nodeName)}.conf</span></a>`,
      )
      .join('');
    const hasProxy = data.protocols.some((p) => p !== 'amneziawg');
    return (
      (hasAwg ? step('DownloadIcon', s[0], { body: `<div class="conf-list">${confs}</div>` }) : '') +
      (hasAwg ? step('Plus', s[1]) : '') +
      (hasAwg ? step('alert', s[2], { box: ' step--warn', tone: ' step__num--warn' }) : '') +
      (hasAwg ? step('Check', s[3], { tone: ' step__num--ok' }) : '') +
      (hasProxy ? step('help', s[4], { tone: ' step__num--info' }) : '')
    );
  }

  const s = t.stepsGeneric;
  // Кнопки двух первых шагов принадлежат ВЫБРАННОМУ клиенту. Сервер рисует их
  // под тот, что загорится первым, дальше их переписывает выбор карточки. Без
  // скрипта они остаются рабочими и ведут туда же, куда вёл бы первый клиент.
  const dlBtn = first?.site
    ? `<div class="step__buttons"><a class="step-btn" data-app-get href="${esc(first.site)}" target="_blank" rel="noopener noreferrer">${icons.draw(
        'ExternalLink',
        { cls: 'ic' },
      )}<span>${esc(t.stepGet)} <b data-app-label>${esc(first.name)}</b></span></a></div>`
    : `<div class="step__buttons" hidden><a class="step-btn" data-app-get href="#">${icons.draw('ExternalLink', { cls: 'ic' })}<span>${esc(t.stepGet)} <b data-app-label></b></span></a></div>`;
  const addBtn =
    first && first.action.kind === 'deeplink'
      ? `<div class="step__buttons"><a class="step-btn" data-app-put href="${esc(deeplinkHref(first.action.scheme, data.subUrl))}">${icons.draw(
          'Plus',
          { cls: 'ic' },
        )}<span>${esc(t.stepAdd)} <b data-app-label>${esc(first.name)}</b></span></a></div>`
      : `<div class="step__buttons" hidden><a class="step-btn" data-app-put href="#">${icons.draw('Plus', { cls: 'ic' })}<span>${esc(t.stepAdd)} <b data-app-label></b></span></a></div>`;
  return (
    step('DownloadIcon', s[0], { body: dlBtn }) +
    step('Plus', s[1], { body: addBtn }) +
    step('help', s[2], { tone: ' step__num--info' }) +
    step('Check', s[3], { tone: ' step__num--ok' })
  );
}

/** Everything one platform's panel holds: the row, the fold, the steps. */
function renderPanel(
  platform: PlatformId,
  data: SubscriptionPageData,
  hasAwg: boolean,
  t: Labels,
  icons: GlyphSheet,
): string {
  const apps = appsFor(platform, data.protocols, hasAwg);
  if (apps.length === 0) return '';
  const { row, rest } = splitApps(apps);
  return (
    `<div class="apps">${cardRows(row, data.subUrl, icons, 'apps__row', ROW_SIZE, row[0]?.name)}` +
    renderTelegramRow(platform, data.protocols, t, icons) +
    `</div>` +
    renderAllApps(platform, apps, rest, data.subUrl, t, icons) +
    renderSteps(platform, data, hasAwg, t, icons, row[0])
  );
}

/**
 * The downloads card.
 *
 * Grouped by WHAT IT IS FOR, never by platform. Somebody takes a config file
 * exactly when the device is a different one: the person setting up a Keenetic
 * from a laptop must still see the Keenetic file, and a card cut by platform
 * would have hidden it from them. The chosen platform therefore reorders and
 * highlights (done in the page's script) and hides nothing.
 *
 * What is NOT here, and each for a reason:
 *   - the body of any config. This is the one place where the secret stops
 *     being hidden behind a token: UUIDs, passwords and PSKs sit in that text
 *     in the clear. So: a link, a copy, a download, under the same amber line
 *     as the transfer window.
 *   - a QR of a config. A dense code scans badly, which is already written
 *     down about the AmneziaVPN key.
 *
 * A format that would come back empty for this subscription is left out: the
 * Shadowsocks-only list without Shadowsocks, the AmneziaWG files without an
 * AmneziaWG node.
 */
/**
 * Каким платформам подходит формат.
 *
 * Точка ОТМЕЧАЕТ и ничего не прячет: за конфигом идут как раз тогда, когда
 * устройство другое, и человек, настраивающий Keenetic с ноутбука, обязан
 * видеть файл для Keenetic. Поэтому список строк один и тот же на всех
 * платформах, и счётчик над ним от выбора платформы не меняется. Пустой список
 * значит «ни одной платформе не отмечаем», а не «спрятать».
 */
const DL_FITS: Record<string, PlatformId[]> = {
  plain: ['windows', 'ios', 'android', 'macos', 'linux', 'androidtv', 'appletv', 'router'],
  clash: ['windows', 'ios', 'android', 'macos', 'linux'],
  singbox: ['windows', 'ios', 'android', 'macos', 'linux', 'androidtv', 'appletv'],
  xrayjson: ['windows', 'ios', 'android', 'macos', 'linux'],
  surge: ['ios', 'macos'],
  quantumultx: ['ios'],
  loon: ['ios'],
  xkeen: ['router'],
  wgconf: ['router'],
};

function renderDownloads(
  data: SubscriptionPageData,
  hasAwg: boolean,
  dead: boolean,
  t: Labels,
  icons: GlyphSheet,
): string {
  const sub = esc(data.subUrl);

  interface Row {
    /** ?format= value, and the key into the phrase dictionary. */
    fmt: string;
    /** Extra query, already escaped. */
    q?: string;
    /** Shown instead of the format name, for the per-node files. */
    label?: string;
    /** `plain` is the subscription itself: a link to copy, never a download.
     *  Clients subscribe to that exact address. */
    noDownload?: boolean;
  }

  /**
   * A row is offered when the format CARRIES something this subscription has.
   *
   * It used to be offered when the subscription had anything that was not
   * AmneziaWG, which reads as "not a tunnel, therefore a proxy". MTProto is
   * neither: no builder emits it, so a subscription whose only node was MTProto
   * was handed five files that each came back without its only server.
   *
   * `hasSs` is gone with it, because it was the same question asked once by
   * hand for the one format anybody had noticed.
   */
  const carries = (fmt: SubscriptionFormat) => formatCarriesAny(fmt, data.protocols);
  const clients: Row[] = (
    [
      'clash',
      'singbox',
      'xrayjson',
      'xrayjson-array',
      'outline',
      'surge',
      'quantumultx',
      'loon',
      'json',
    ] as const
  )
    .filter(carries)
    .map((fmt) => ({ fmt }));
  // One tunnel per server, and that shape must survive: a person with three
  // AmneziaWG nodes who is handed one file walks away thinking they took
  // everything.
  const perNode = (fmt: string): Row[] =>
    (data.awgNodes ?? []).map((n) => ({
      fmt,
      q: `&amp;node=${encodeURIComponent(n.nodeName)}`,
      label: n.nodeName,
    }));
  const router: Row[] = [
    ...(carries('xkeen') ? [{ fmt: 'xkeen' }] : []),
    ...(hasAwg ? perNode('wgconf') : []),
  ];
  const other: Row[] = [
    ...(hasAwg ? perNode('amneziavpn') : []),
    { fmt: 'plain', noDownload: true },
  ];

  /**
   * MTProto, one row per node, with the link itself.
   *
   * Not a `?format=` row, because there is no format: no builder emits MTProto,
   * so this row IS the way to use such a node from this page. Until now the
   * page drew a Telegram card of instructions with no link in it, and the only
   * way to get one was to read the raw subscription by hand.
   *
   * The https form on the button, because it opens the app from anywhere and
   * survives being sent to somebody; the same link on the copy button, so a
   * person who cannot follow it here can paste it where they can.
   */
  const telegram = (data.mtprotoNodes ?? [])
    .map((n) => {
      const link = n.tmeUri || n.uri;
      const name = `${t.formatNames['mtproto'] ?? 'Telegram'} · ${n.nodeName}`;
      return (
        `<div class="dl-row" data-dl-fits="">` +
        `<div class="dl-row__col">` +
        `<div class="dl-row__name"><span class="dl-row__dot" aria-hidden="true"></span>${esc(name)}</div>` +
        // Amber, like every other row that hands out ONE server rather than the
        // whole subscription.
        `<div class="dl-row__note dl-row__note--warn">${esc(t.formats['mtproto'] ?? '')}</div>` +
        `</div>` +
        `<div class="dl-row__actions">` +
        `<button class="dl-btn dl-btn--ghost" type="button" data-copy-text="${esc(link)}">${icons.draw('copy', { cls: 'ic' })}<span>${esc(t.dlCopy)}</span></button>` +
        `<a class="dl-btn" href="${esc(link)}">${icons.draw('ExternalLink', { cls: 'ic' })}<span>${esc(t.tgOpen)}</span></a>` +
        `</div></div>`
      );
    })
    .join('');

  /**
   * SOCKS5 and HTTP for Telegram, beside MTProto: the same kind of handout
   * (one server, inside Telegram only), but with the person's OWN login, so
   * the row is theirs and not the node's.
   */
  const telegramProxies = (data.telegramProxies ?? [])
    .map((p) => {
      const key = p.kind === 'socks' ? 'tg-socks' : 'tg-http';
      const name = `${t.formatNames[key] ?? key} · ${p.nodeName}`;
      const head =
        `<div class="dl-row" data-dl-fits="">` +
        `<div class="dl-row__col">` +
        `<div class="dl-row__name"><span class="dl-row__dot" aria-hidden="true"></span>${esc(name)}</div>` +
        `<div class="dl-row__note dl-row__note--warn">${esc(t.formats[key] ?? '')}</div>`;
      if (p.kind === 'socks' && p.tgUri) {
        return (
          head +
          `</div>` +
          `<div class="dl-row__actions">` +
          `<button class="dl-btn dl-btn--ghost" type="button" data-copy-text="${esc(p.tgUri)}">${icons.draw('copy', { cls: 'ic' })}<span>${esc(t.dlCopy)}</span></button>` +
          `<a class="dl-btn" href="${esc(p.tgUri)}">${icons.draw('ExternalLink', { cls: 'ic' })}<span>${esc(t.tgOpen)}</span></a>` +
          `</div></div>`
        );
      }
      // HTTP: no link exists, so the fields themselves, selectable, and the
      // password on a button because nobody types a UUID.
      const f = t.tgHttpFields;
      const field = (label: string, value: string) =>
        `<span class="dl-row__field">${esc(label)} <code>${esc(value)}</code></span> `;
      return (
        head +
        `<div class="dl-row__note">` +
        field(f.server, p.host) +
        field(f.port, String(p.port)) +
        field(f.login, p.username) +
        field(f.password, p.password) +
        `</div></div>` +
        `<div class="dl-row__actions">` +
        `<button class="dl-btn dl-btn--ghost" type="button" data-copy-text="${esc(p.password)}">${icons.draw('copy', { cls: 'ic' })}<span>${esc(f.copyPassword)}</span></button>` +
        `</div></div>`
      );
    })
    .join('');

  const row = (r: Row) => {
    const href = `${sub}?format=${r.fmt}${r.q ?? ''}`;
    // Имя это то, ЧЕМ строка является для читателя, а не ключ формата.
    // «clash» подписчику не значит ничего, «Clash-совместимые» значит, а сами
    // клиенты уходят в подпись под именем.
    const title = t.formatNames[r.fmt] ?? r.fmt;
    const name = r.label ? `${title} · ${r.label}` : title;
    // Строка, которая выдаёт один туннель на один сервер, а не всю подписку,
    // говорит об этом янтарным: иначе человек с тремя AWG-нодами скачает один
    // файл и решит, что забрал всё. Такие строки это ровно понодовые.
    const note = r.label ? ' dl-row__note--warn' : '';
    return (
      `<div class="dl-row" data-dl-fits="${DL_FITS[r.fmt]?.join(' ') ?? ''}"><div class="dl-row__col">` +
      `<div class="dl-row__name"><span class="dl-row__dot" aria-hidden="true"></span>${esc(name)}</div>` +
      `<div class="dl-row__note${note}">${esc(t.formats[r.fmt] ?? '')}</div></div>` +
      // Кнопки в своей обёртке: на телефоне строка становится колонкой, и они
      // уезжают под текст одной парой, а не рвут строку пополам.
      `<div class="dl-row__actions">` +
      // У строки без скачивания копирование и есть основное действие, поэтому
      // приглушённой она не идёт: приглушают вторую кнопку, а не единственную.
      `<button class="dl-btn${r.noDownload ? '' : ' dl-btn--ghost'}" type="button" data-copy-config="${href}">${icons.draw('copy', { cls: 'ic' })}<span>${esc(t.dlCopy)}</span></button>` +
      (r.noDownload
        ? ''
        : `<a class="dl-btn" href="${href}&amp;dl=1">${icons.draw('DownloadIcon', { cls: 'ic' })}<span>${esc(t.dlGet)}</span></a>`) +
      `</div></div>`
    );
  };
  const group = (title: string, id: string, rows: Row[]) =>
    rows.length === 0
      ? ''
      : `<div class="dl-group" data-dl-group="${id}">` +
        `<div class="all-apps__group-title">${esc(title)}</div>` +
        rows.map(row).join('') +
        `</div>`;

  // Пока подписка не действует, строк НЕТ НИ ОДНОЙ.
  //
  // Не «приглушены, но кликабельны», как было: все форматы идут через тот же
  // generateSubscription, который и бросил отказ, поэтому 403 придёт по любому
  // адресу, включая саму ссылку подписки. Приглушённая кликабельная строка
  // вела бы в стену, а это ровно тот мёртвый контроль, от которого страницу
  // чистят. Вместо строк красная плашка, она говорит, когда всё вернётся.
  //
  // Счётчик при этом остаётся: он называет, сколько форматов у подписки, а не
  // сколько кнопок можно нажать сегодня.
  const body = dead
    ? ''
    : group(t.dlGroupClients, 'clients', clients) +
      group(t.dlGroupRouter, 'router', router) +
      // The Telegram rows sit with the other per-server handouts, which is what
      // they are: one node, one link, not the subscription.
      (telegram || telegramProxies
        ? `<div class="dl-group" data-dl-group="other"><div class="all-apps__group-title">${esc(t.dlGroupOther)}</div>${telegram}${telegramProxies}</div>`
        : '') +
      group(t.dlGroupOther, 'other', other);
  const count =
    clients.length +
    router.length +
    other.length +
    (data.mtprotoNodes?.length ?? 0) +
    (data.telegramProxies?.length ?? 0);
  // Нечего предложить и подписка в силе: карточки нет. Нечего предложить
  // ПОТОМУ ЧТО она не в силе: карточка остаётся. Блок, который исчезает, учит
  // читателя, что его там и не было, и продливший идёт искать вчерашнюю кнопку.
  if (count === 0 && !dead) return '';
  // Folded by the same expander as "all apps", and behind the same amber line
  // as the transfer window: one mechanism each, not a second of each.
  // This is the only block on the page that changes with the state.
  return `<div class="dl-card" id="downloads">
    <div class="all-apps all-apps--flat${dead ? ' is-open is-dead' : ''}" data-all-apps>
      <div class="all-apps__top">
        <div class="all-apps__line">
          ${icons.draw('DownloadIcon', { cls: 'ic dl-mark' })}
          <span class="all-apps__title">${esc(t.dlTitle)}</span>
          <span class="all-apps__count">${count}</span>
          <button class="all-apps__toggle" type="button" data-toggle-all aria-expanded="${dead}">
            <span>${esc(dead ? t.hideAll : t.showAll)}</span>${icons.draw('chevron', { cls: 'ic ic--sel' })}
          </button>
        </div>
        <div class="all-apps__note dl-note--shut">${esc(t.dlNote)}</div>
        <div class="all-apps__note dl-note--open">${esc(t.dlHint)}</div>
      </div>
      <div class="all-apps__body">
        ${dead ? `<div class="dl-dead">${icons.draw('AlertCircle', { cls: 'ic' })}<span>${esc(t.dlDead)}</span></div>` : ''}
        <div class="dl-groups">${body}</div>
        <div class="modal__warn dl-warn">${icons.draw('alert', { cls: 'ic' })}<span>${esc(t.dlWarn)}</span></div>
      </div>
    </div>
  </div>`;
}

/** How the subscription card presents itself: which badge, which tint, and the
 *  sentence under the name. */
interface StatusView {
  /** Class suffixes, '' for the plain form. */
  badge: string;
  note: string;
  statusTile: string;
  expiresTile: string;
  trafficTile: string;
  icon: GlyphKey;
  line: string;
}

/** Warn this many days before the end. A week is the shortest notice that
 *  still lets somebody pay on a weekday. */
const EXPIRY_WARNING_DAYS = 7;

/** Warn when this little of the traffic allowance is left. */
const TRAFFIC_WARNING_SHARE = 0.05;

/**
 * The six states of the card.
 *
 * Four of them (expired, limit reached, disabled, revoked) belong to a
 * subscription that is NOT in force. `generateSubscription` refuses those
 * before it has any endpoints (subscription.service.ts:519-531), so the page
 * is built for them from the refusal itself: no protocols, no install block,
 * just who this is and why nothing works. The route decides which; see
 * `refusalPage` in subscription.routes.ts.
 */
function statusView(
  u: SubscriptionPageData['user'],
  t: Labels,
  lang: 'ru' | 'en',
  custom?: SubscriptionPageData['deadTexts'],
): StatusView {
  // Not in force. Everything reads as stopped, and the line says what to do,
  // because this page is the last thing a lapsed subscriber sees.
  if (u.status !== 'active') {
    // Слово оператора важнее нашего, но только если оно есть. Пустая строка и
    // строка из пробелов это НЕ текст: оператор стёр поле, а не написал в него
    // пустоту, и подставить её значило бы оставить читателя без объяснения.
    const own = custom?.[u.status as 'expired' | 'limited' | 'disabled']?.[lang]?.trim();
    const dead: StatusView = {
      badge: ' sub-card__badge--bad',
      note: ' sub-card__note--bad',
      statusTile: ' tile--bad',
      expiresTile: '',
      trafficTile: '',
      icon: 'AlertCircle',
      line: own || t.noteStopped[u.status] || t.noteStopped.disabled!,
    };
    // Tint the tile that explains the refusal, and only that one: on an
    // expired subscription the traffic figure is not the problem.
    if (u.status === 'expired') return { ...dead, expiresTile: ' tile--bad' };
    if (u.status === 'limited') return { ...dead, trafficTile: ' tile--bad' };
    if (u.status === 'disabled' || u.status === 'revoked') {
      return { ...dead, icon: 'power', statusTile: ' tile--mute', badge: ' sub-card__badge--mute' };
    }
    return dead;
  }

  const ok: StatusView = {
    badge: '',
    note: '',
    statusTile: ' tile--ok',
    expiresTile: '',
    trafficTile: '',
    icon: 'Check',
    line: t.noteNoExpiry,
  };

  // Running out of traffic, checked before the date because it is the one that
  // arrives without warning: a date is on the card every day, a gigabyte count
  // is not something anyone watches.
  const total = u.trafficLimitBytes;
  const lowOnTraffic =
    total !== null && total > 0 && total - u.trafficUsedBytes <= total * TRAFFIC_WARNING_SHARE;

  const left = u.expireAt ? daysUntil(u.expireAt) : null;
  const expiringSoon = left !== null && left <= EXPIRY_WARNING_DAYS;

  if (lowOnTraffic && !expiringSoon) {
    return {
      ...ok,
      badge: ' sub-card__badge--warn',
      note: ' sub-card__note--warn',
      trafficTile: ' tile--warn',
      icon: 'ChartBar',
      line: t.noteTrafficLow
        .replace('{left}', fmtBytes(Math.max(0, total! - u.trafficUsedBytes)))
        .replace('{total}', fmtBytes(total!)),
    };
  }

  if (left === null) return ok;
  const days = `${left} ${plural(left, t.days)}`;
  if (!expiringSoon) {
    return { ...ok, line: t.noteActive.replace('{n}', days) };
  }
  // Still active, and that is the point of the amber: the subscription works
  // and the reader has a week to decide, so the status tile stays green while
  // the date and the line say what is coming.
  return {
    ...ok,
    badge: ' sub-card__badge--warn',
    note: ' sub-card__note--warn',
    expiresTile: ' tile--warn',
    icon: 'clock',
    line: t.noteExpiring.replace('{n}', days),
  };
}

/** Место листа значков в разметке. Подставляется, когда всё уже нарисовано. */
const SPRITE_SLOT = '<!--glyph-sheet-->';

export function buildSubscriptionPage(data: SubscriptionPageData): string {
  const t = L[data.lang];
  const u = data.user;
  // Collects the artwork this particular page draws. Emitted once, near the
  // top of the body, and referenced from everywhere it is shown.
  const icons = createGlyphSheet();

  const used = Math.max(0, u.trafficUsedBytes);
  const total = u.trafficLimitBytes;
  const trafficStr =
    total === null || total <= 0
      ? `${fmtBytes(used)} / ${t.unlimited}`
      : `${fmtBytes(used)} / ${fmtBytes(total)}`;
  const expiresStr = u.expireAt ? fmtDate(u.expireAt, data.lang) : t.noExpiry;
  const statusLabel = t.statusValues[u.status] ?? u.status;
  const st = statusView(u, t, data.lang, data.deadTexts);

  const awgNodes = data.awgNodes ?? [];
  const multiAwg = awgNodes.length > 1;
  const hasAwg = awgNodes.length > 0;

  // Инструкция по установке НЕ ждёт, пока нода ответит.
  //
  // Приложения и шаги это справочник: какой клиент поставить, куда нажать,
  // что разрешить системе. Он одинаков у всех и ничего не выдаёт. Пока список
  // строился только от протоколов подписки, страница у юзера с семью
  // профилями и тридцатью привязками оказывалась ПУСТОЙ просто потому, что
  // статус-поллер пометил ноды недоступными: справочник исчезал вслед за
  // живостью флота, хотя не зависит от неё ни одной строкой.
  //
  // Поэтому: есть протоколы, режем по ним, как и раньше. Нет ни одного,
  // показываем весь справочник. Выдача при этом не подделывается: конфиги и
  // ссылки по-прежнему идут от настоящих данных, а полоса выше говорит, что
  // серверов пока нет.
  /**
   * A subscription that is not in force gets THREE things and nothing else:
   * the state card, the link with a copy button, and support if there is one.
   *
   * Everything else on this page answers "how do I connect", and for this
   * reader that question has one honest answer, which is "you cannot yet".
   * Install steps, eight app panels and a config button are then not help,
   * they are a person following instructions that end at a wall, and the
   * config button is worse than useless: every format goes through the same
   * generator that refused, so it hands out a 403.
   *
   * The link stays, and stays copyable, because it does not change: keeping it
   * is exactly what the person should do, and the line under it says so.
   */
  const dead = u.status !== 'active';

  const noServers = data.protocols.length === 0;
  const appData = noServers ? { ...data, protocols: [...PROTOCOL_NAMES] as ProtocolName[] } : data;

  // Rendered ONCE per platform and kept. The previous shape rendered every
  // platform a second time just to ask whether its panel would be empty, which
  // was only wasteful while renderApps was pure. It now records which artwork
  // the page needs, and throwing away output that had a side effect is the
  // kind of thing that comes back as a mark in the sprite nobody references.
  const rendered = PLATFORM_ORDER.map(
    (p) => [p, renderPanel(p, appData, hasAwg || noServers, t, icons)] as const,
  ).filter(([, html]) => html !== '');
  const platforms = rendered.map(([p]) => p);
  const first = platforms[0];
  // The selector, with the platforms that have nothing to offer left out
  // entirely: the tab row did that and it is the behaviour worth keeping.
  const menuHtml = platforms
    .map(
      (p, i) =>
        `<button class="platform__item${i === 0 ? ' is-on' : ''}" type="button" role="option" data-pick="${p}" aria-selected="${i === 0}">${icons.draw(PLATFORM_GLYPH[p], { cls: 'ic' })}<span>${esc(platformLabel(p, t))}</span></button>`,
    )
    .join('');
  const pickerHtml = first
    ? `<div class="platform" data-platform-picker>
      <button class="platform__btn" type="button" data-platform-btn aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(t.pickPlatformBtn)}">
        <span data-platform-icon>${icons.draw(PLATFORM_GLYPH[first], { cls: 'ic' })}</span>
        <span data-platform-name>${esc(platformLabel(first, t))}</span>
        ${icons.draw('selector', { cls: 'ic ic--sel' })}
      </button>
      <div class="platform__menu" role="listbox">${menuHtml}</div>
    </div>`
    : '';
  const panelsHtml = rendered
    .map(
      ([p, html], i) =>
        `<section class="panel${i === 0 ? ' is-on' : ''}" data-platform="${p}" aria-label="${esc(t.setup)}, ${esc(platformLabel(p, t))}">${html}</section>`,
    )
    .join('');

  // Not reachable today: a user whose subscription is expired, disabled or
  // limited is refused before this page is built (see statusView). Written as
  // the condition rather than as a constant so it starts working the day the
  // route learns to answer HTML for a refusal.
  // Nothing on a page that cannot connect anybody: see dead above.
  const downloadsHtml = dead ? '' : renderDownloads(data, hasAwg, false, t, icons);

  const protocolChips = data.protocols.map((p) => `<span class="proto">${esc(p)}</span>`).join('');

  // Compact import widget: ONE QR shown at a time. A server selector picks the
  // AmneziaWG node (no more one-tower-of-QRs-per-node sprawl), an AmneziaVPN /
  // AmneziaWG toggle swaps the vpn:// key QR vs the .conf QR, and the proxy
  // subscription QR is just another selectable target. Each figure carries its
  // PAYLOAD, not a picture of it, and the browser draws the code; the inline
  // script shows/hides by (target, app).
  // The subscription QR moved to the transfer window and is NOT drawn here as
  // well: two copies of the same code is the most expensive decoration there
  // is, and a second box is a second encode on the reader's phone.
  // What stays is the AmneziaWG widget, which is a different code per node and
  // has nowhere else to live.
  interface ImportTarget {
    id: string;
    label: string;
  }
  const targets: ImportTarget[] = [];
  // Chip label is the product name, not the raw node/city: a single AWG node
  // reads "AmneziaWG", not "London". Only disambiguate by node when there's more
  // than one AmneziaWG server.
  for (const n of awgNodes)
    targets.push({ id: `awg:${n.nodeName}`, label: multiAwg ? `AmneziaWG · ${n.nodeName}` : 'AmneziaWG' });

  const figures: string[] = [];
  awgNodes.forEach((n, ni) => {
    // The first node's vpn:// QR is what the widget opens on.
    const vpnOn = ni === 0 ? ' on' : '';
    if (n.vpnKey) {
      const copyBtn = `<button class="copyk" type="button" data-key="${esc(n.vpnKey)}">${esc(t.copyKey)}</button>`;
      figures.push(
        `<figure class="qrf${vpnOn}" data-target="awg:${esc(n.nodeName)}" data-app="vpn">` +
          qrBox({ text: n.vpnKey, fallback: n.vpnKey, note: t.qrNeedsJs, esc }) +
          `<figcaption>AmneziaVPN</figcaption>${copyBtn}</figure>`,
      );
    }
    if (n.conf) {
      figures.push(
        `<figure class="qrf" data-target="awg:${esc(n.nodeName)}" data-app="conf">` +
          qrBox({ text: n.conf, fallback: n.conf, note: t.qrNeedsJs, esc }) +
          `<figcaption>AmneziaWG</figcaption></figure>`,
      );
    }
  });

  // Server chooser. Same control as the platform one in "Set up", down to the
  // classes: two selectors that behave differently on one page is a cost the
  // reader pays, not us. Only when there is more than one server to choose.
  const targetSel =
    targets.length > 1
      ? `<div class="platform" data-node-picker>
        <button class="platform__btn" type="button" data-node-btn aria-haspopup="listbox" aria-expanded="false">
          ${icons.draw('AmneziaWG', { cls: 'ic' })}
          <span data-node-name>${esc(targets[0]!.label)}</span>
          ${icons.draw('selector', { cls: 'ic ic--sel' })}
        </button>
        <div class="platform__menu" role="listbox">${targets
          .map(
            (tg, i) =>
              `<button class="platform__item${i === 0 ? ' is-on' : ''}" type="button" role="option" data-target="${esc(tg.id)}" aria-selected="${i === 0}">${icons.draw('AmneziaWG', { cls: 'ic' })}<span>${esc(tg.label)}</span></button>`,
          )
          .join('')}</div>
      </div>`
      : '';
  // AmneziaVPN against AmneziaWG is one thing in two forms, not two actions,
  // so it is a segmented block like the pair in the header, not two buttons
  // standing apart.
  const appSel = hasAwg
    ? `<div class="seg-group" role="tablist">
      <button class="seg-btn is-on" type="button" role="tab" aria-selected="true" data-app="vpn">AmneziaVPN</button>
      <button class="seg-btn" type="button" role="tab" aria-selected="false" data-app="conf">AmneziaWG</button>
    </div>`
    : '';
  const scanSection =
    !dead && figures.length > 0
      ? `<section class="card scan" id="scan">
    <div class="install__head">
      <h2 class="install__title">${esc(t.scanTitle)}</h2>
      ${targetSel}
    </div>
    <div class="note-strip">${icons.draw('AlertCircle', { cls: 'ic' })}<div class="note-strip__text">${esc(multiAwg ? t.oneTunnelMany : t.oneTunnel)}</div></div>
    ${appSel}
    <div class="qrview">${figures.join('')}</div>
  </section>`
      : '';

  // Transfer window: the subscription link as a code, for a second device.
  // Drawn from the link the page already carries, so the window needs no data
  // of its own, and the link below it stays readable whether or not the code
  // gets drawn. On a dead subscription the window goes: moving a subscription
  // that does not work to a second device is not a thing to offer.
  const transferHtml = !dead
    ? `<div class="overlay" data-transfer>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
    <span class="modal__handle" aria-hidden="true"></span>
    <div class="modal__head">
      <div class="modal__col">
        <div class="modal__title" id="transfer-title">${esc(t.transferTitle)}</div>
        <div class="modal__note">${esc(t.transferNote)}</div>
      </div>
      <button class="modal__close" type="button" data-close-transfer aria-label="${esc(t.close)}">${icons.draw('x', { cls: 'ic' })}</button>
    </div>
    <div class="qr-plate">${qrBox({ text: data.subUrl, fallback: data.subUrl, note: t.qrNeedsJs, esc })}</div>
    <div class="link-box">
      <div class="link-box__label">${esc(t.subLink)}</div>
      <div class="link-box__value">${esc(data.subUrl)}</div>
    </div>
    <button class="modal__copy" type="button" data-copy-modal>${icons.draw('copy', { cls: 'ic' })}<span>${esc(t.copy)}</span></button>
    <div class="modal__warn">${icons.draw('alert', { cls: 'ic' })}<span>${esc(t.transferWarn)}</span></div>
  </div>
</div>`
    : '';

  const supportRow = data.supportUrl
    ? `<a class="support" href="${esc(data.supportUrl)}">${esc(t.support)} -&gt;</a>`
    : '';

  /**
   * One line under the link, only when the subscription is not in force.
   *
   * The link card itself is already on the page and stays exactly as it is:
   * this page has one way of showing a link and does not grow a second. What
   * the refusal page adds is the answer to the question it always raises, "am
   * I going to be given a new address", asked where the address is.
   */
  const deadLinkNote = dead
    ? `<div class="dead-note">${esc(t.deadLinkNote)}</div>`
    : '';

  const doc = `<!DOCTYPE html>
<html lang="${data.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>${esc(data.brandTitle)}</title>
<style>${PAGE_CSS}</style>
</head>
<body class="nojs">
${SPRITE_SLOT}
<div class="page">
  <header class="head">
    <div class="head__brand">
      ${icons.draw('cube', { cls: 'ic' })}
      <span class="head__title">${esc(data.brandTitle)}</span>
    </div>
    <div class="head__actions">
      ${
        transferHtml
          ? `<button class="hbtn hbtn--qr" type="button" data-open-transfer>
        ${icons.draw('qr', { cls: 'ic' })}<span class="hbtn__full">${esc(t.transfer)}</span><span class="hbtn__short">${esc(t.transferShort)}</span>
      </button>`
          : ''
      }
      <button class="hbtn hbtn--copy" type="button" id="copy">
        ${icons.draw('copy', { cls: 'ic' })}<span class="hbtn__full">${esc(t.copyLink)}</span><span class="hbtn__short">${esc(t.copyLinkShort)}</span>
      </button>
    </div>
  </header>

  <main class="wrap">
  <section class="card sub-card">
    <div class="sub-card__head">
      <div class="sub-card__badge${st.badge}">${icons.draw(st.icon, { cls: 'ic' })}</div>
      <div class="sub-card__who">
        <div class="sub-card__name">${esc(u.username)}</div>
        <div class="sub-card__note${st.note}">${esc(st.line)}</div>
      </div>
    </div>
    <div class="sub-card__grid">
      <div class="sub-card__row">
        <div class="tile">
          <div class="tile__label">${icons.draw('User', { cls: 'ic' })}<span>${esc(t.username)}</span></div>
          <div class="tile__value">${esc(u.username)}</div>
        </div>
        <div class="tile${st.statusTile}">
          <div class="tile__label">${icons.draw('check-circle', { cls: 'ic' })}<span>${esc(t.status)}</span></div>
          <div class="tile__value">${esc(statusLabel)}</div>
        </div>
      </div>
      <div class="sub-card__row">
        <div class="tile${st.expiresTile}">
          <div class="tile__label">${icons.draw('Calendar', { cls: 'ic' })}<span>${esc(t.expires)}</span></div>
          <div class="tile__value">${esc(expiresStr)}</div>
        </div>
        <div class="tile${st.trafficTile}">
          <div class="tile__label">${icons.draw('ChartBar', { cls: 'ic' })}<span>${esc(t.traffic)}</span></div>
          <div class="tile__value">${esc(trafficStr)}</div>
        </div>
      </div>
    </div>
    ${protocolChips ? `<div><div class="lbl" style="margin-bottom:8px">${esc(t.protocols)}</div><div class="protos">${protocolChips}</div></div>` : ''}
  </section>

  <section class="card" id="sublink">
    <div class="lbl">${esc(t.subLink)}</div>
    <div class="linkrow">
      <input class="link" id="url" value="${esc(data.subUrl)}" readonly onclick="this.select()">
      <button class="copy" id="copy-inline">${esc(t.copy)}</button>
    </div>
    ${deadLinkNote}
  </section>

  ${
    /* «Забрать конфигом» это последний блок ВНУТРИ «Установки», а не карточка
       под ней: за конфигом идут, когда установка по ссылке не сложилась, и
       искать его надо там же, где инструкция.

       Когда серверов ещё нет, карточка всё равно на месте и со всем
       справочником: исчезала она раньше, и страница из-за этого читалась как
       сломанная, хотя сломаны были данные. Полоса сверху говорит правду, а
       инструкция остаётся: ставить приложение можно и до выдачи доступа. */
    /* ⚠ `downloadsHtml` counts too, and that is not a detail. A subscription
       whose only node is MTProto names no app on any platform: MTProto is not
       a client, it is a setting inside Telegram. So `platforms` came out empty
       and this whole section disappeared, taking with it the one row that
       could have handed the reader their proxy link. The page then showed a
       working subscription with nothing on it at all (issue #41). */
    !dead && (platforms.length > 0 || downloadsHtml !== '')
      ? `<section class="card install">
    <div class="install__head">
      <h1 class="install__title">${esc(t.setup)}</h1>
      ${pickerHtml}
    </div>
    ${
      noServers
        ? `<div class="note-strip">
      ${icons.draw('AlertCircle', { cls: 'ic' })}
      <div class="note-strip__text"><b class="note-strip__title">${esc(t.noServersTitle)}</b>${esc(t.noServers)}</div>
    </div>`
        : ''
    }
    ${panelsHtml}
    ${downloadsHtml}
  </section>`
      : ''
  }

  ${scanSection}

  ${supportRow}
  </main>
  <footer class="foot">
    <nav class="lang" aria-label="Language">
      <a class="lng${data.lang === 'ru' ? ' on' : ''}" href="?lang=ru" hreflang="ru"${data.lang === 'ru' ? ' aria-current="true"' : ''}>Русский</a>
      <span class="lang__sep">·</span>
      <a class="lng${data.lang === 'en' ? ' on' : ''}" href="?lang=en" hreflang="en"${data.lang === 'en' ? ' aria-current="true"' : ''}>English</a>
    </nav>
  </footer>
</div>
${transferHtml}
<!-- Two tags, not one: a throw in either script stops only that one, and the
     page has to survive losing its codes as readily as losing its tabs. -->
<script>${QR_SCRIPT}</script>
<script>${pageScript({ subUrl: data.subUrl, noTransfer: NO_TRANSFER, copied: t.copied, hideAll: t.hideAll, showAll: t.showAll })}</script>
</body>
</html>`;

  // Лист рисуется ПОСЛЕДНИМ, а стоит ПЕРВЫМ.
  //
  // `draw` копит ключи, `sprite()` отдаёт то, что накопилось на момент вызова,
  // а куски внутри этого же шаблона считаются уже после него. Пока вызов стоял
  // прямо в разметке, в лист попадало только нарисованное в переменных выше
  // (меню платформ, блок конфигов, модалка), а `cube`, `User`, `check-circle`,
  // `Calendar` и `ChartBar` рисуются ниже по шаблону, и пять `use` ссылались в
  // пустоту: кружок статуса без галки, плитки без значков. Метка разрывает этот
  // порядок, не двигая лист в конец документа, где `use` на первом кадре мигают.
  return doc.replace(SPRITE_SLOT, icons.sprite());
}
