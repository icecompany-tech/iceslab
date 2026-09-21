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

import { PROTOCOL_NAMES, type ProtocolName } from '@iceslab/shared';
import {
  APP_MARK,
  GLYPHS,
  createGlyphSheet,
  type Glyph,
  type GlyphKey,
  type GlyphSheet,
} from './page-icons.js';

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
  /** "Scan to import the whole subscription" QR for proxy clients. */
  subUrlQrSvg?: string;
  /** One entry per AmneziaWG node, each with its two QRs: the AmneziaVPN
   *  "vpn://" key (for the AmneziaVPN app) and the native .conf (for the
   *  AmneziaWG app). Single-tunnel-per-key, so a user with several AWG servers
   *  gets one labelled QR pair per server instead of just the first node's. */
  awgNodes?: Array<{
    nodeName: string;
    confQrSvg?: string;
    vpnQrSvg?: string;
    /** Raw AmneziaVPN vpn:// key for a copy button (the dense key QR is
     *  unreliable on screen, so paste-the-key is the robust import path). */
    vpnKey?: string;
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

type PlatformId =
  | 'ios'
  | 'android'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'androidtv'
  | 'appletv'
  | 'router';

/** Which glyph stands for a platform in the selector.
 *
 *  The names are uneven because their origins are: the five that came with the
 *  icon library kept its spelling, and the three the library had no glyph for
 *  (both televisions and the router) were drawn for the layout and carry the
 *  prototype's `pf-` ids. Linux is Ubuntu's mark, which is the one the set has
 *  and the one people recognise. */
const PLATFORM_GLYPH: Record<PlatformId, GlyphKey> = {
  ios: 'AppleIcon',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Ubuntu',
  androidtv: 'pf-androidtv',
  appletv: 'pf-appletv',
  router: 'pf-router',
};

const PLATFORM_ORDER: PlatformId[] = [
  'ios',
  'android',
  'windows',
  'macos',
  'linux',
  'androidtv',
  'appletv',
  'router',
];

// Display labels. Most are proper nouns (same in both languages); only Router
// differs, handled in L below via routerLabel.
const PLATFORM_LABEL: Record<PlatformId, string> = {
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  androidtv: 'Android TV',
  appletv: 'Apple TV',
  router: '',
};

// ───── Apps ─────
//
// Curated, protocol-accurate. An app shows on a platform tab only when that
// platform is in `platforms` AND it speaks at least one of the subscription's
// protocols. AmneziaWG obfuscation (Jc/S/H/I) needs an AWG-aware client, so the
// xray/ss subscription clients are NOT listed for amneziawg, and vice versa.

type AppAction =
  | {
      kind: 'deeplink';
      scheme:
        | 'hiddify'
        | 'streisand'
        | 'v2rayng'
        | 'clash'
        | 'singbox'
        | 'shadowrocket'
        | 'happ'
        | 'v2raytun';
    }
  | { kind: 'awg-vpn' } // scan the AmneziaVPN vpn:// QR below
  | { kind: 'awg-conf' } // scan the AmneziaWG .conf QR below
  | { kind: 'download' } // grab the per-node .conf below
  | { kind: 'manual' }; // paste the subscription link

interface AppDef {
  name: string;
  platforms: PlatformId[];
  protocols: ProtocolName[];
  action: AppAction;
  recommended?: boolean;
  /**
   * This one is a routing console, not a paste-the-link client.
   *
   * The split is the reader's, not ours: one group is "installed it and it
   * works", the other asks them to understand rules, chains and a TUN mode
   * before anything connects. Handing a newcomer v2rayN next to Happ, in one
   * undifferentiated list, is how they conclude the service is broken.
   *
   * Absent means the plain kind. Flagged here from the field notes in
   * docs/plan/subscription-clients.md ("Класс второй, инструмент").
   */
  advanced?: boolean;
}

const APPS: AppDef[] = [
  // Happ and v2RayTun first: these are the clients the operator's own
  // subscribers are already on, and until now the page offered neither, so the
  // most common reader of this page was told to copy a link by hand while
  // every other app got a button.
  {
    // Vendor requirements page, checked 2026-09-21: iOS 15+, Android 5+,
    // Windows 10 (1809)+/11, macOS 13+, Linux, "Android TV 5.0+" and
    // "Apple TV (tvOS 15+)". Linux was missing here and is theirs.
    name: 'Happ',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'happ' },
    recommended: true,
  },
  {
    // ⚠ Android only, and that is a shrunk list, not the original one.
    // Checked 2026-09-21: the App Store returns NOTHING for this app - not by
    // track id (6476628951), not by bundle id, not by name, in us/ru/tj/kz/am/tr.
    // It is gone from the store, so ios and macos would send a reader to an
    // empty page. The Windows builds in circulation are not the author's, and
    // this app is marked recommended, which is a promise we cannot keep for a
    // stranger's binary. Google Play still serves com.v2raytun.android.
    // If it comes back, the fix is to put the platforms back on this line.
    name: 'v2RayTun',
    platforms: ['android'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'v2raytun' },
    recommended: true,
  },
  // Universal subscription clients (xray / shadowsocks / hysteria via the link).
  {
    // No androidtv: the TV build request is closed as not planned, and the
    // remote cannot reach part of the screen (hiddify-app #1246, #969). The apk
    // installs on a TV, which is not the same as being usable with a remote.
    name: 'Hiddify',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    protocols: ['amneziawg', 'xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'hiddify' },
    recommended: true,
  },
  {
    // sing-box.sagernet.org/clients lists the Apple client as
    // "iOS/macOS/Apple tvOS", so tvOS was simply missing here.
    name: 'sing-box',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'singbox' },
  },
  {
    // One of the three clients that actually cover both TV platforms, and the
    // only one we were missing. Download page, 2026-09-21: iOS, tvOS, Android,
    // "Android TV Stable Version (armeabi-v7a)", Windows, macOS, Linux.
    // No deep link is documented, so the honest action is the link.
    name: 'Karing',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
    recommended: true,
  },
  {
    // App Store compatibility, 2026-09-21: iPhone, iPad, Mac (M1+), Vision Pro.
    // No Apple TV, so the appletv that stood here offered tvOS owners an app
    // they cannot install.
    name: 'Streisand',
    platforms: ['ios', 'macos'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'streisand' },
    recommended: true,
  },
  {
    // appletv STAYS. App Store compatibility, 2026-09-21: "Apple TV: Requires
    // tvOS 17.0 or later", alongside "Mac: Requires macOS 10.15 or later"
    // (Catalina, so a real Mac build rather than an iOS app on Apple silicon).
    // Both are the vendor's own claims on the store page.
    name: 'Shadowrocket',
    platforms: ['ios', 'macos', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'shadowrocket' },
  },
  {
    // No androidtv: the launcher activity carries no LEAN_BACK_LAUNCHER, so the
    // app does not appear in a TV's app list at all (v2rayNG #1848, unanswered).
    // That is why a separate Android-TV fork exists.
    name: 'v2rayNG',
    platforms: ['android'],
    protocols: ['xray', 'shadowsocks'],
    action: { kind: 'deeplink', scheme: 'v2rayng' },
    recommended: true,
  },
  {
    name: 'NekoBox',
    platforms: ['android'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
    advanced: true,
  },
  {
    name: 'v2rayN',
    platforms: ['windows'],
    protocols: ['xray', 'shadowsocks'],
    action: { kind: 'manual' },
    advanced: true,
  },
  {
    // Was Nekoray. That repository was archived by its owner on 2025-03-17 with
    // "no longer maintained, find alternatives yourself" and names no successor;
    // Throne (throneproj/Throne) is the community continuation, sing-box core,
    // Windows/Linux/macOS out of the box. We were pointing readers at an
    // archive.
    name: 'Throne',
    platforms: ['windows', 'linux', 'macos'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
    advanced: true,
  },
  {
    name: 'Clash Verge',
    platforms: ['windows', 'macos', 'linux'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'clash' },
    advanced: true,
  },
  {
    name: 'FlClash',
    platforms: ['android', 'windows', 'macos', 'linux'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'clash' },
  },
  {
    // INCY (incy-app.com). Cross-platform client; imports our subscription via
    // its "add server from URL / QR". One-tap import needs its incy://crypt1
    // deep link (AES-GCM payload from @incy/link-encoder); wire that up once the
    // package is installed (see deeplinkHref). Until then: import via the link.
    name: 'INCY',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
  },
  // AmneziaWG-specific.
  {
    // No androidtv: their own download page offers Windows, macOS, iOS,
    // Android and Linux, and nothing for a television (checked 2026-09-21).
    // Not in the brief's table, same defect as the rows that were: with an
    // AmneziaWG subscription this was the one app a TV owner was shown.
    name: 'AmneziaVPN',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    protocols: ['amneziawg'],
    action: { kind: 'awg-vpn' },
    recommended: true,
  },
  {
    name: 'AmneziaWG',
    platforms: ['ios', 'android'],
    protocols: ['amneziawg'],
    action: { kind: 'awg-conf' },
  },
  {
    name: 'wg-quick / awg',
    platforms: ['linux', 'router'],
    protocols: ['amneziawg'],
    action: { kind: 'download' },
  },
  {
    name: 'Keenetic',
    platforms: ['router'],
    protocols: ['amneziawg'],
    action: { kind: 'download' },
  },
  {
    // PassWall (Xray) and HomeProxy (sing-box, "the modern ImmortalWrt proxy
    // platform") both live here, so the proxy subscription is as applicable on
    // this box as the AmneziaWG config is, just by hand.
    name: 'OpenWrt',
    platforms: ['router'],
    protocols: ['amneziawg', 'xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
  },
  {
    // The xray path on Keenetic, which the registry did not have: Entware on a
    // USB drive, then `opkg install xray` or XKeen ("selective traffic routing
    // through Xray and Mihomo on Keenetic/Netcraze routers"), config by hand in
    // /opt/etc/xray. Separate from the Keenetic row above because that one is
    // the AmneziaWG .conf download and this one is a link to paste.
    name: 'XKeen / Entware',
    platforms: ['router'],
    protocols: ['xray', 'shadowsocks'],
    action: { kind: 'manual' },
  },
];

function deeplinkHref(
  scheme: Extract<AppAction, { kind: 'deeplink' }>['scheme'],
  subUrl: string,
): string {
  const enc = encodeURIComponent(subUrl);
  switch (scheme) {
    case 'hiddify':
      return `hiddify://import/${subUrl}`;
    case 'streisand':
      return `streisand://import/${subUrl}`;
    case 'v2rayng':
      return `v2rayng://install-sub?url=${enc}`;
    case 'clash':
      return `clash://install-config?url=${enc}`;
    case 'singbox':
      return `sing-box://import-remote-profile?url=${enc}`;
    case 'shadowrocket':
      return `sub://${Buffer.from(subUrl, 'utf8').toString('base64')}`;
    // The wrapper form both apps document: the subscription URL is appended
    // whole, the way hiddify:// and streisand:// take it, not as a query
    // parameter. Verified 2026-09-11 against docs.v2raytun.com/deep-link for
    // v2raytun://import/ and against the Happ-family INCY deep-link docs plus a
    // third-party resolver that handles happ://add/ for the other. Both apps
    // also have an encrypted variant (happ://crypt*, v2raytun://crypt) which
    // needs their key material, so the plain wrapper is what we emit.
    case 'happ':
      return `happ://add/${subUrl}`;
    case 'v2raytun':
      return `v2raytun://import/${subUrl}`;
  }
}

interface StepText {
  title: string;
  text: string;
}

interface Labels {
  status: string;
  traffic: string;
  expires: string;
  username: string;
  /** Header actions. The short forms are what fits a phone: the buttons are
   *  half a screen wide there, and a clipped label is worse than a shorter one. */
  transfer: string;
  transferShort: string;
  copyLink: string;
  copyLinkShort: string;
  /** The line under the name. `{n}` is the already-pluralised day count. */
  noteActive: string;
  noteNoExpiry: string;
  noteExpiring: string;
  noteTrafficLow: string;
  /** The line for a subscription that is not in force, keyed by status. */
  noteStopped: Record<string, string>;
  /** day / days, in the three Russian forms and the two English ones. */
  days: readonly [string, string, string];
  telegram: string;
  telegramNote: string;
  pickPlatformBtn: string;
  /** Second level. `{p}` is the platform's own name. */
  allApps: string;
  allAppsNote: string;
  wholeList: string;
  showAll: string;
  hideAll: string;
  groupPlain: string;
  groupAdvanced: string;
  /** Steps. The shape is in code (icon, tint, order); only the words are here. */
  stepsGeneric: readonly StepText[];
  stepsTv: readonly StepText[];
  stepsRouter: readonly StepText[];
  enterOnTv: string;
  /** The downloads card. `formats` is keyed by the `?format=` value. */
  dlTitle: string;
  dlNote: string;
  dlWarn: string;
  dlGroupClients: string;
  dlGroupRouter: string;
  dlGroupOther: string;
  dlGet: string;
  dlCopy: string;
  dlDead: string;
  /** Подсказка про точку, показывается только в раскрытом блоке конфигов. */
  dlHint: string;
  /** Когда подписке не выдано ни одного сервера. */
  noServersTitle: string;
  noServers: string;
  /** Короткое имя строки: чем формат ЯВЛЯЕТСЯ для читателя. */
  formatNames: Record<string, string>;
  formats: Record<string, string>;
  /** Transfer window. */
  transferTitle: string;
  transferNote: string;
  transferWarn: string;
  close: string;
  noExpiry: string;
  unlimited: string;
  protocols: string;
  subLink: string;
  copy: string;
  copied: string;
  copyKey: string;
  setup: string;
  scanTitle: string;
  support: string;
  routerLabel: string;
  statusValues: Record<string, string>;
}

const L: Record<'ru' | 'en', Labels> = {
  en: {
    status: 'Status',
    traffic: 'Traffic',
    expires: 'Expires',
    username: 'Username',
    transfer: 'Another device',
    transferShort: 'Another device',
    copyLink: 'Copy link',
    copyLinkShort: 'Link',
    noteActive: 'Active, {n} left',
    noteNoExpiry: 'Active, no expiry date',
    noteExpiring: 'Expires in {n}, renew before it does',
    noteTrafficLow: '{left} of {total} left, and access stops at the limit',
    noteStopped: {
      expired: 'The subscription has run out. Renew it and this page works again, with the same link.',
      limited: 'The traffic allowance is used up. Access resumes when the allowance is renewed.',
      disabled: 'The subscription is switched off. Your operator can switch it back on.',
      revoked: 'This link has been withdrawn. Ask your operator for a new one.',
    },
    days: ['day', 'days', 'days'],
    telegram: 'Telegram',
    telegramNote:
      'MTProto, SOCKS5 or HTTP. Only the messenger itself, and only in the app: the web version has no proxy settings.',
    pickPlatformBtn: 'Device',
    allApps: 'All apps for {p}',
    allAppsNote: 'The ones above are enough. This is everything else that works.',
    wholeList: 'This is the whole list for {p}, not a selection.',
    showAll: 'Show',
    hideAll: 'Hide',
    groupPlain: 'INSTALL AND IT WORKS',
    groupAdvanced: 'FOR FINE CONTROL, HARDER',
    stepsGeneric: [
      {
        title: 'Install the app',
        text: 'Pick one above and install it from your system’s store or from its own site.',
      },
      {
        title: 'Add the subscription',
        text: 'Press the app’s card above and the subscription goes straight into it. Install the app first, or the system has nobody to hand the link to.',
      },
      {
        title: 'If nothing was added',
        text: 'Copy the link with the `Copy link` button above. In the app, open its list of profiles, add one from a URL and paste the link there.',
      },
      {
        title: 'Connect',
        text: 'Choose the profile you just added and turn the connection on. The system asks for VPN permission once.',
      },
    ],
    stepsTv: [
      {
        title: 'Install it on the television',
        text: 'Search for the app by name in the store on the television itself. If the firmware has no store, it installs as an apk through Downloader; ask your operator for the address.',
      },
      {
        title: 'Getting the subscription onto the television',
        text: 'The add button is no help here: the television cannot open a link pressed on your phone. It has no camera either, so there is nothing to scan the code with. The link is typed on the television, in the app’s add-by-URL field.',
      },
      {
        title: 'If typing with the remote is painful',
        text: 'Install your television’s remote-control app on your phone: it gives you a normal keyboard, and the link is pasted in seconds. On Android TV boxes, entering text through the Google account page does the same job.',
      },
      {
        title: 'Connect and use',
        text: 'Pick a server with the remote and connect; the television asks for VPN permission once. Keep the app in the recents list: some firmware evicts it from memory and the tunnel drops.',
      },
    ],
    stepsRouter: [
      {
        title: 'Configuration file',
        text: 'A router holds one connection at a time, so there is a file per server. Download the one you want to leave through.',
      },
      {
        title: 'Loading it into the router',
        text: 'On Keenetic: Internet, Other connections, add WireGuard and upload the file. On OpenWrt install amneziawg-tools and import the config under Network. From a console the file goes to /etc/amnezia/amneziawg and comes up with awg-quick.',
      },
      {
        title: 'Plain WireGuard will not do',
        text: 'The file carries the masking parameters Jc, S1, S2, H1 and H4. Firmware without AmneziaWG support does not understand them: the connection either fails to come up or comes up and is conspicuous. If your router only speaks classic WireGuard, install an app on the devices instead.',
      },
      {
        title: 'Check it, and what changes',
        text: 'Once the tunnel is up the whole home network goes through it, television and set-top box included, and those need no app of their own any more. Check the external address from any device: it should match the country of the server you chose.',
      },
      {
        title: 'If the subscription is not AmneziaWG',
        text: 'A router can carry the ordinary subscription too, just not as a file. On Keenetic that is Entware from a USB drive plus Xray; on OpenWrt the PassWall or HomeProxy package. The XKeen file is right here on this page, in the `take it as a config file` block below.',
      },
    ],
    enterOnTv: 'TYPE THIS ON THE TELEVISION',
    dlTitle: 'Take it as a config file',
    dlNote:
      'For when the app cannot be given a subscription link: a router, an offline machine, a client that only imports files.',
    dlWarn:
      'A config file carries your keys and passwords in plain text. Anyone who gets the file gets your access.',
    dlGroupClients: 'FOR CLIENTS ON THIS DEVICE',
    dlGroupRouter: 'FOR A ROUTER',
    dlGroupOther: 'FOR ANOTHER DEVICE',
    dlDead: 'While the subscription is not in force, no config is issued: these addresses answer with a refusal, the same one that brought you to this page. Everything comes back the moment it is renewed, on the same link.',
    dlGet: 'Download',
    dlCopy: 'Config',
    dlHint:
      'The dot marks what suits the platform you picked. The rest is left on purpose: a config is taken for another device more often than for this one.',
    noServersTitle: 'No servers yet. ',
    noServers:
      'This subscription has not been issued a single server, so there is nothing to name an app for and nothing to hand out as a config. It all appears here the moment the operator grants access, on this same link: you will not need to fetch it again.',
    formatNames: {
      clash: 'Clash-compatible',
      singbox: 'sing-box',
      xrayjson: 'Xray JSON',
      'xrayjson-array': 'Xray JSON, as an array',
      outline: 'Outline',
      surge: 'Surge',
      quantumultx: 'Quantumult X',
      loon: 'Loon',
      json: 'List of endpoints',
      xkeen: 'XKeen on Keenetic',
      wgconf: 'wg-quick / awg',
      amneziavpn: 'AmneziaVPN key',
      plain: 'Subscription link',
    },
    formats: {
      clash: 'Clash Verge, FlClash, Clash Mi. The whole subscription in one file',
      singbox: 'sing-box, Karing, Hiddify. The whole subscription in one file',
      xrayjson: 'v2rayN, Throne, Happ. The whole subscription in one file',
      'xrayjson-array': 'The same servers as separate configs, which is how Happ and v2RayTun read them',
      outline: 'Shadowsocks only, SIP008: Outline and the shadowsocks clients',
      surge: 'iOS and macOS. Paid app',
      quantumultx: 'iOS. Paid app',
      loon: 'iOS. Paid app',
      json: 'The panel’s own list of endpoints, for tooling',
      xkeen: 'Keenetic with XKeen: outbounds and routing, no inbound',
      wgconf: 'One tunnel to one server, not the whole subscription',
      amneziavpn: 'Copy it and paste it into the app, which reads it itself. One tunnel to one server',
      plain: 'The subscription itself, base64. This is what a client pulls from the link',
    },
    transferTitle: 'Move this to another device',
    transferNote:
      'Point a phone or tablet camera at it. The subscription opens there; nothing needs installing on this device.',
    transferWarn: 'Whoever gets this code gets your subscription. Do not post it anywhere.',
    close: 'Close',
    noExpiry: 'no expiry',
    unlimited: 'unlimited',
    protocols: 'Protocols',
    subLink: 'Subscription link',
    copy: 'Copy',
    copied: 'Copied',
    copyKey: 'Copy key',
    setup: 'Set up',
    scanTitle: 'Scan to add',
    support: 'Support',
    routerLabel: 'Router',
    statusValues: {
      active: 'active',
      revoked: 'withdrawn',
      disabled: 'disabled',
      expired: 'expired',
      limited: 'limit reached',
    },
  },
  ru: {
    status: 'Статус',
    traffic: 'Трафик',
    expires: 'Истекает',
    username: 'Имя пользователя',
    transfer: 'Другое устройство',
    transferShort: 'Другое устройство',
    copyLink: 'Скопировать ссылку',
    copyLinkShort: 'Ссылка',
    noteActive: 'Активна, осталось {n}',
    noteNoExpiry: 'Активна, без срока',
    noteExpiring: 'Истекает через {n}, продлите заранее',
    noteTrafficLow: 'Осталось {left} из {total}, на лимите доступ остановится',
    noteStopped: {
      expired: 'Срок подписки закончился. Продлите, и страница снова заработает, ссылка та же.',
      limited: 'Лимит трафика исчерпан. Доступ вернётся, когда лимит обновят.',
      disabled: 'Подписка выключена. Включить её может оператор.',
      revoked: 'Эта ссылка отозвана. Запросите у оператора новую.',
    },
    days: ['день', 'дня', 'дней'],
    telegram: 'Телеграм',
    telegramNote:
      'MTProto, SOCKS5 или HTTP. Работает только сам мессенджер и только в приложении: в веб-версии полей прокси нет.',
    pickPlatformBtn: 'Устройство',
    allApps: 'Все приложения для {p}',
    allAppsNote: 'Тех, что выше, достаточно. Здесь всё остальное, что тоже работает.',
    wholeList: 'Это весь список для {p}, а не выборка.',
    showAll: 'Показать',
    hideAll: 'Скрыть',
    groupPlain: 'ПОСТАВИЛ И РАБОТАЕТ',
    groupAdvanced: 'ДЛЯ ТОНКОЙ НАСТРОЙКИ, СЛОЖНЕЕ',
    stepsGeneric: [
      {
        title: 'Установка приложения',
        text: 'Выберите приложение выше и поставьте его: в магазине своей системы или с сайта разработчика.',
      },
      {
        title: 'Добавление подписки',
        text: 'Нажмите карточку приложения выше, и подписка уйдёт прямо в него. Приложение должно быть уже установлено, иначе системе некому передать ссылку.',
      },
      {
        title: 'Если подписка не добавилась',
        text: 'Скопируйте ссылку кнопкой «Скопировать ссылку» вверху страницы. В приложении откройте список профилей, добавьте новый профиль по URL и вставьте её туда.',
      },
      {
        title: 'Подключение',
        text: 'Выберите добавленный профиль и включите подключение. Разрешение на VPN система спросит один раз.',
      },
    ],
    stepsTv: [
      {
        title: 'Установка на телевизор',
        text: 'Найдите приложение по названию в магазине на самом телевизоре. Если магазина на прошивке нет, приложение ставится apk через Downloader, адрес спросите у оператора.',
      },
      {
        title: 'Перенос подписки на телевизор',
        text: 'Кнопка добавления тут не поможет: телевизор не откроет ссылку, нажатую на телефоне. Камеры у телевизора тоже нет, сканировать код нечем. Поэтому ссылку вводят на самом телевизоре, в приложении это пункт добавления по URL.',
      },
      {
        title: 'Если вводить пультом неудобно',
        text: 'Поставьте на телефон приложение-пульт для своего телевизора: оно даёт обычную клавиатуру, и ссылка вставляется за несколько секунд. На приставках Android TV ту же роль выполняет ввод через аккаунт Google на странице устройства.',
      },
      {
        title: 'Подключение и использование',
        text: 'Выберите сервер пультом и нажмите подключение, телевизор один раз спросит разрешение на VPN. Держите приложение в списке недавних: на части прошивок система выгружает его из памяти и туннель рвётся.',
      },
    ],
    stepsRouter: [
      {
        title: 'Файл конфигурации',
        text: 'Роутер держит одно соединение за раз, поэтому файл свой на каждый сервер. Скачайте тот, через который хотите выходить.',
      },
      {
        title: 'Загрузка в роутер',
        text: 'На Keenetic: Интернет, Другие подключения, добавить WireGuard и загрузить файл. На OpenWrt поставьте пакет amneziawg-tools и импортируйте конфиг в разделе Network. Через консоль файл кладётся в /etc/amnezia/amneziawg и поднимается командой awg-quick.',
      },
      {
        title: 'Обычный WireGuard не подойдёт',
        text: 'В файле есть параметры маскировки Jc, S1, S2, H1 и H4. Прошивка без поддержки AmneziaWG их не поймёт: соединение либо не встанет, либо встанет и будет заметным. Если роутер умеет только классический WireGuard, ставьте приложение на устройства.',
      },
      {
        title: 'Проверка и правила',
        text: 'После подъёма туннеля через него пойдёт вся домашняя сеть, включая телевизор и приставку, отдельные приложения им уже не нужны. Проверьте внешний адрес с любого устройства: он должен совпасть со страной выбранного сервера.',
      },
      {
        title: 'Если подписка не на AmneziaWG',
        text: 'Роутер потянет и обычную подписку, только ставится она не файлом. На Keenetic это Entware с USB-накопителя и Xray, на OpenWrt пакет PassWall или HomeProxy. Готовый файл для XKeen лежит ниже, в блоке «Забрать конфигом».',
      },
    ],
    enterOnTv: 'ВВЕСТИ НА ТЕЛЕВИЗОРЕ',
    dlTitle: 'Забрать конфигом',
    dlNote:
      'На случай, когда приложению нельзя отдать ссылку подписки: роутер, машина без интернета, клиент, который умеет только файл.',
    dlWarn:
      'В файле конфигурации ключи и пароли лежат открытым текстом. Кто получит файл, получит и ваш доступ.',
    dlGroupClients: 'ДЛЯ КЛИЕНТОВ НА ЭТОМ УСТРОЙСТВЕ',
    dlGroupRouter: 'ДЛЯ РОУТЕРА',
    // Не «сама подписка»: в группе лежат ключи AmneziaVPN, а их как раз
    // переносят на соседнее устройство, и заголовок должен называть повод.
    dlGroupOther: 'ДЛЯ ДРУГОГО УСТРОЙСТВА',
    dlDead: 'Пока подписка не действует, конфиги не выдаются: по этим адресам приходит тот же отказ, что привёл вас на эту страницу. Всё вернётся сразу после продления, ссылка та же.',
    dlGet: 'Скачать',
    dlCopy: 'Конфиг',
    dlHint:
      'Точкой отмечено то, что подходит выбранной платформе. Остальное оставлено нарочно: конфиг чаще забирают для другого устройства, чем для этого.',
    noServersTitle: 'Серверов пока нет. ',
    noServers:
      'Этой подписке не выдано ни одного сервера, поэтому называть приложение и выдавать конфиг пока нечем. Всё появится здесь сразу, как оператор выдаст доступ, и ссылка останется той же: брать её заново не нужно.',
    formatNames: {
      clash: 'Clash-совместимые',
      singbox: 'sing-box',
      xrayjson: 'Xray JSON',
      'xrayjson-array': 'Xray JSON, массивом',
      outline: 'Outline',
      surge: 'Surge',
      quantumultx: 'Quantumult X',
      loon: 'Loon',
      json: 'Список точек входа',
      xkeen: 'XKeen на Keenetic',
      wgconf: 'wg-quick / awg',
      amneziavpn: 'Ключ AmneziaVPN',
      plain: 'Ссылка подписки',
    },
    formats: {
      clash: 'Clash Verge, FlClash, Clash Mi. Вся подписка одним файлом',
      singbox: 'sing-box, Karing, Hiddify. Вся подписка одним файлом',
      xrayjson: 'v2rayN, Throne, Happ. Вся подписка одним файлом',
      'xrayjson-array': 'Те же серверы отдельными конфигами, именно так их читают Happ и v2RayTun',
      outline: 'Только Shadowsocks, SIP008: Outline и клиенты shadowsocks',
      surge: 'iOS и macOS. Приложение платное',
      quantumultx: 'iOS. Приложение платное',
      loon: 'iOS. Приложение платное',
      json: 'Собственный список точек входа панели, для инструментов',
      xkeen: 'Keenetic с XKeen: исходящие и маршрутизация, без входящего',
      wgconf: 'Один туннель на один сервер, а не вся подписка',
      amneziavpn: 'Скопировать и вставить в приложение, оно разберёт само. Один туннель на один сервер',
      plain: 'Сама подписка, base64. Именно это забирает клиент по ссылке',
    },
    transferTitle: 'Перенести на другое устройство',
    transferNote:
      'Наведите камеру телефона или планшета. Подписка откроется там же, ставить приложение на этом устройстве не нужно.',
    transferWarn: 'Кто получит этот код, получит и вашу подписку. Не выкладывайте его никуда.',
    close: 'Закрыть',
    noExpiry: 'без срока',
    unlimited: 'безлимит',
    protocols: 'Протоколы',
    subLink: 'Ссылка подписки',
    copy: 'Копировать',
    copied: 'Скопировано',
    copyKey: 'Скопировать ключ',
    setup: 'Установка',
    scanTitle: 'Сканировать',
    support: 'Поддержка',
    routerLabel: 'Роутер',
    statusValues: {
      active: 'активна',
      revoked: 'отозвана',
      disabled: 'отключена',
      expired: 'истекла',
      limited: 'лимит исчерпан',
    },
  },
};

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
function renderAppCard(a: AppDef, subUrl: string, icons: GlyphSheet): string {
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
    `<a class="app-card" href="${esc(href)}"${ink !== undefined ? ` style="--mark-o:${ink}"` : ''}>` +
    `${dot}<span class="app-card__name">${esc(a.name)}</span>${glyph}${mark}</a>`
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
): string {
  const rows: string[] = [];
  for (let i = 0; i < apps.length; i += per) {
    const chunk = apps.slice(i, i + per);
    const pad = '<span class="spacer"></span>'.repeat(per - chunk.length);
    rows.push(`<div class="${cls}">${chunk.map((a) => renderAppCard(a, subUrl, icons)).join('')}${pad}</div>`);
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
  return (
    step('DownloadIcon', s[0]) +
    step('Plus', s[1]) +
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
    `<div class="apps">${cardRows(row, data.subUrl, icons, 'apps__row')}` +
    renderTelegramRow(platform, data.protocols, t, icons) +
    `</div>` +
    renderAllApps(platform, apps, rest, data.subUrl, t, icons) +
    renderSteps(platform, data, hasAwg, t, icons)
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
  const hasSs = data.protocols.includes('shadowsocks');
  const hasProxy = data.protocols.some((p) => p !== 'amneziawg');

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

  const clients: Row[] = hasProxy
    ? [
        { fmt: 'clash' },
        { fmt: 'singbox' },
        { fmt: 'xrayjson' },
        { fmt: 'xrayjson-array' },
        ...(hasSs ? [{ fmt: 'outline' }] : []),
        { fmt: 'surge' },
        { fmt: 'quantumultx' },
        { fmt: 'loon' },
        { fmt: 'json' },
      ]
    : [];
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
    ...(hasProxy ? [{ fmt: 'xkeen' }] : []),
    ...(hasAwg ? perNode('wgconf') : []),
  ];
  const other: Row[] = [
    ...(hasAwg ? perNode('amneziavpn') : []),
    // Not while the subscription is refused: every one of these addresses
    // answers 403 for such a user, and a row that cannot deliver is the kind
    // of dead control the whole page is being cleaned of. See the note in
    // the card body, which says so in words.
    ...(dead ? [] : [{ fmt: 'plain', noDownload: true }]),
  ];

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

  const body =
    group(t.dlGroupClients, 'clients', clients) +
    group(t.dlGroupRouter, 'router', router) +
    group(t.dlGroupOther, 'other', other);
  // Nothing to offer and the subscription is in force: no card. Nothing to
  // offer BECAUSE it is not in force: the card stays, empty, with the red
  // line explaining why. A block that vanishes teaches the reader it was
  // never there, and the person who has just renewed goes looking for it.
  if (body === '' && !dead) return '';
  const count = clients.length + router.length + other.length;
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
function statusView(u: SubscriptionPageData['user'], t: Labels): StatusView {
  // Not in force. Everything reads as stopped, and the line says what to do,
  // because this page is the last thing a lapsed subscriber sees.
  if (u.status !== 'active') {
    const dead: StatusView = {
      badge: ' sub-card__badge--bad',
      note: ' sub-card__note--bad',
      statusTile: ' tile--bad',
      expiresTile: '',
      trafficTile: '',
      icon: 'AlertCircle',
      line: t.noteStopped[u.status] ?? t.noteStopped.disabled!,
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
  const st = statusView(u, t);

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
  const downloadsHtml = renderDownloads(data, hasAwg, u.status !== 'active', t, icons);

  const protocolChips = data.protocols.map((p) => `<span class="proto">${esc(p)}</span>`).join('');

  // Compact import widget: ONE QR shown at a time. A server selector picks the
  // AmneziaWG node (no more one-tower-of-QRs-per-node sprawl), an AmneziaVPN /
  // AmneziaWG toggle swaps the vpn:// key QR vs the .conf QR, and the proxy
  // subscription QR is just another selectable target. Every QR SVG is embedded
  // once; the inline script shows/hides by (target, app). All SVG is trusted
  // (server-generated), so embedded raw, never escaped.
  // The subscription QR moved to the transfer window and is NOT drawn here as
  // well: one QR svg is 25 KB on a page that has to open over a censored link,
  // and two copies of the same code is the most expensive decoration there is.
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
    if (n.vpnQrSvg) {
      const copyBtn = n.vpnKey
        ? `<button class="copyk" type="button" data-key="${esc(n.vpnKey)}">${esc(t.copyKey)}</button>`
        : '';
      figures.push(
        `<figure class="qrf${vpnOn}" data-target="awg:${esc(n.nodeName)}" data-app="vpn"><div class="qbx">${n.vpnQrSvg}</div><figcaption>AmneziaVPN</figcaption>${copyBtn}</figure>`,
      );
    }
    if (n.confQrSvg) {
      figures.push(
        `<figure class="qrf" data-target="awg:${esc(n.nodeName)}" data-app="conf"><div class="qbx">${n.confQrSvg}</div><figcaption>AmneziaWG</figcaption></figure>`,
      );
    }
  });

  const targetSel =
    targets.length > 1
      ? `<div class="segs tgsel" role="tablist">${targets
          .map(
            (tg, i) =>
              `<button class="seg${i === 0 ? ' on' : ''}" data-target="${esc(tg.id)}">${esc(tg.label)}</button>`,
          )
          .join('')}</div>`
      : '';
  // AmneziaVPN / AmneziaWG toggle, only meaningful for an AWG target. Hidden at
  // first when the default target is the proxy subscription QR; the script
  // reveals it the moment an AWG server is selected.
  const appSel = hasAwg
    ? `<div class="segs appsel" role="tablist"><button class="seg on" data-app="vpn">AmneziaVPN</button><button class="seg" data-app="conf">AmneziaWG</button></div>`
    : '';
  const scanSection =
    figures.length > 0
      ? `<section class="card" id="scan">
    <div class="lbl">${esc(t.scanTitle)}</div>
    ${targetSel}
    ${appSel}
    <div class="qrview">${figures.join('')}</div>
  </section>`
      : '';

  // Transfer window. The QR is the one qrSvg() already builds for the
  // subscription link (subscription.routes.ts), shown in a new place rather
  // than generated again; without it there is nothing to put in the window.
  const transferHtml = data.subUrlQrSvg
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
    <div class="qr-plate">${data.subUrlQrSvg}</div>
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

  const doc = `<!DOCTYPE html>
<html lang="${data.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>${esc(data.brandTitle)}</title>
<style>
  /* Palette from the mockup (Paper, file icelab-panel, column 12). Names are
     kept where they already existed, so a later change is one place. */
  :root{
    --ground:#0A0F16; --card:#0E1621; --card2:#111B27; --tile:#131E2B;
    --sunk:#0B121B; --hair:#1E2936; --hair2:#23303F;
    --edge-accent:#2B7A8C; --edge-accent2:#2B5A66;
    --snow:#F0F5FA; --mist:#7E8EA0; --faint:#5B6B80;
    --cyan:#4FD1C5; --cyan-bg:#0D1A21; --brand:#7DD3FC;
    --warn:#F2B355; --warn-ink:#C9A56A; --warn-bg:#1C1810; --warn-edge:#4A3A1E;
    --bad:#F87171;  --bad-ink:#C98A8A;  --bad-bg:#1C1418;  --bad-edge:#4A2229;
    --ok:#4ADE80;   --ok-ink:#7FBF95;   --ok-bg:#101E17;   --ok-edge:#2B663F;
    --mute-bg:#151C25; --mute-edge:#33404F; --mark:#8CA0B8;
    --col:740px;
    /* Older names, still used by the blocks that have not been rebuilt yet
       (the link card, the platform tabs, the QR widget, the downloads). Each
       points at its nearest new value so the page is one design in the
       meantime; they go away with the markup that uses them. */
    --ground2:var(--sunk); --cyan2:var(--edge-accent); --moss:var(--ok); --dim:var(--faint);
    --mono:'Geist Mono Variable',ui-monospace,SFMono-Regular,'SF Mono','Cascadia Code',Menlo,Consolas,monospace;
    --sans:'Space Grotesk','Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  }
  *{box-sizing:border-box;}
  html,body{margin:0; padding:0;}
  body{
    background:var(--ground); color:var(--snow); font-family:var(--sans);
    font-size:14px; line-height:1.45; -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale; overflow-wrap:anywhere; min-height:100vh;
  }
  button{font:inherit; color:inherit; background:none; border:0; padding:0; cursor:pointer;}
  svg{flex-shrink:0;}
  .sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;}
  /* Ambient: a faint blueprint grid + one calm cyan glow up top. */
  body::before{
    content:""; position:fixed; inset:0; z-index:-1; pointer-events:none;
    background:
      radial-gradient(900px 420px at 50% -120px, rgba(125,211,252,.10), transparent 70%),
      linear-gradient(var(--hair) 1px, transparent 1px) 0 0/100% 34px,
      linear-gradient(90deg, var(--hair) 1px, transparent 1px) 0 0/34px 100%;
    background-color:var(--ground);
    opacity:1;
    -webkit-mask-image:radial-gradient(closest-side at 50% 18%, #000 60%, transparent 100%);
            mask-image:radial-gradient(closest-side at 50% 18%, #000 60%, transparent 100%);
  }
  .page{display:flex; flex-direction:column; align-items:center; min-height:100vh;}
  .wrap{width:100%; max-width:var(--col); padding:0 16px; display:flex; flex-direction:column; gap:24px;}

  /* Размер значка по умолчанию.
     Размеры задаются контекстом (.hbtn .ic, .tile__label .ic и так далее), и
     пока это был ЕДИНСТВЕННЫЙ источник размера, значок без своего правила
     оставался без ширины и высоты, а браузер давал безразмерному svg дефолт
     замещаемого элемента, 300x150. Так и разъезжались шевроны у «все
     приложения» и у блока конфигов. База ниже это просто страховка: любое
     контекстное правило её перекрывает, а без правила значок теперь мелкий,
     а не в пол-экрана. */
  .ic{width:16px; height:16px; flex-shrink:0;}
  .ic--sel{width:12px; height:12px;}

  /* Header: the mark and the name centred, the two things a reader does with
     this page on one row under them. The theme button the old header carried
     is deliberately gone - it promised a light theme that does not exist. */
  .head{width:100%; display:flex; flex-direction:column; align-items:center; gap:18px; padding:30px 16px 0;}
  .head__brand{display:flex; align-items:center; gap:10px;}
  .head__title{font-size:19px; font-weight:700; line-height:24px; letter-spacing:-.01em; color:var(--brand);}
  .head__brand .ic{width:20px; height:20px; color:var(--brand);}
  .head__actions{
    width:100%; max-width:var(--col); display:flex; gap:4px; padding:4px;
    border-radius:13px; background:var(--card); border:1px solid var(--hair);
  }
  .hbtn{
    flex:1 1 0; min-width:0; display:flex; align-items:center; justify-content:center; gap:8px;
    height:36px; border-radius:10px; background:var(--card2); border:1px solid var(--hair2);
    font-size:13px; font-weight:500; color:#C8D4E3; text-decoration:none;
  }
  .hbtn .ic{width:14px; height:14px;}
  .hbtn--qr{background:var(--cyan-bg); border-color:var(--edge-accent); color:var(--cyan);}
  .hbtn:hover{border-color:var(--edge-accent2);}
  .hbtn__short{display:none;}

  /* Cards */
  .card{background:var(--card); border:1px solid var(--hair); border-radius:18px; padding:22px; position:relative;}

  /* Subscription card: who this is, then four facts as tiles. */
  .sub-card{display:flex; flex-direction:column; gap:20px;}
  .sub-card__head{display:flex; align-items:center; gap:15px;}
  .sub-card__badge{
    width:42px; height:42px; flex-shrink:0; border-radius:999px;
    display:flex; align-items:center; justify-content:center;
    background:var(--ok-bg); border:1px solid var(--ok-edge); color:var(--ok);
  }
  .sub-card__badge .ic{width:17px; height:17px;}
  .sub-card__badge--warn{background:#241C10; border-color:#5B4726; color:var(--warn);}
  .sub-card__badge--bad{background:#2A1519; border-color:#5B2A31; color:var(--bad);}
  .sub-card__badge--mute{background:var(--mute-bg); border-color:var(--mute-edge); color:var(--mist);}
  .sub-card__who{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:3px;}
  .sub-card__name{font-size:19px; font-weight:700; line-height:24px;}
  .sub-card__note{font-size:13px; line-height:17px; color:var(--mist);}
  .sub-card__note--warn{color:var(--warn-ink);}
  .sub-card__note--bad{color:var(--bad-ink);}
  .sub-card__grid{display:flex; flex-direction:column; gap:12px;}
  .sub-card__row{display:flex; gap:12px;}
  .tile{
    flex:1 1 0; min-width:0; min-height:74px; display:flex; flex-direction:column; gap:7px;
    padding:14px 16px; border-radius:13px; background:var(--tile); border:1px solid var(--hair2);
  }
  .tile--ok{background:var(--ok-bg); border-color:var(--ok-edge);}
  .tile--warn{background:var(--warn-bg); border-color:var(--warn-edge);}
  .tile--bad{background:var(--bad-bg); border-color:var(--bad-edge);}
  .tile--mute{background:var(--mute-bg); border-color:var(--mute-edge);}
  .tile__label{display:flex; align-items:center; gap:8px; min-height:16px; font-size:12px; line-height:16px; color:var(--mist);}
  .tile__label .ic{width:13px; height:13px;}
  .tile--ok .tile__label{color:var(--ok-ink);}
  .tile--warn .tile__label{color:var(--warn-ink);}
  .tile--bad .tile__label{color:var(--bad-ink);}
  .tile__value{font-size:15px; font-weight:700; line-height:19px; color:var(--snow); overflow-wrap:anywhere;}
  .lbl{color:var(--mist); font-family:var(--mono); font-size:10px; text-transform:uppercase;
    letter-spacing:.16em; margin-bottom:12px;}

  .protos{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;}
  .proto{font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.08em;
    color:var(--cyan); background:rgba(125,211,252,.07); border:1px solid rgba(125,211,252,.18);
    border-radius:6px; padding:3px 8px;}

  /* Subscription link */
  .linkrow{display:flex; gap:8px;}
  input.link{flex:1; min-width:0; background:var(--ground2); border:1px solid var(--hair); color:var(--snow);
    border-radius:9px; padding:11px 12px; font-family:var(--mono); font-size:12px;}
  .copy{cursor:pointer; border:none; border-radius:9px; padding:0 16px; font-weight:600; font-size:13px;
    background:var(--cyan2); color:var(--ground); white-space:nowrap;}
  .copy:active{transform:translateY(1px);}

  /* Install block: the platform lives in the heading now. Eight of them do not
     fit a scrolling row at this width, and a scrolling row nobody notices is
     the same as a hidden one. */
  .install{display:flex; flex-direction:column; gap:18px;}
  .install__head{display:flex; align-items:center; gap:16px;}
  .install__title{flex:1 1 0; min-width:0; margin:0; font-size:20px; font-weight:700; line-height:24px;}
  .platform{position:relative; flex-shrink:0;}
  .platform__btn{display:flex; align-items:center; gap:10px; height:36px; padding:0 14px;
    border-radius:11px; background:var(--card2); border:1px solid var(--edge-accent);
    font-size:13px; font-weight:500; color:var(--snow);}
  .platform__btn .ic{width:15px; height:15px;}
  .platform__btn .ic--sel{width:11px; height:11px;}
  .platform__menu{position:absolute; right:0; top:calc(100% + 6px); z-index:40; min-width:200px;
    display:none; flex-direction:column; padding:6px; gap:2px;
    border-radius:12px; background:var(--card2); border:1px solid var(--hair2);
    box-shadow:0 18px 40px rgba(4,8,13,.55);}
  .platform.is-open .platform__menu{display:flex;}
  .platform__item{display:flex; align-items:center; gap:10px; height:34px; padding:0 10px;
    border-radius:8px; font-size:13px; color:#C8D4E3; text-align:left;}
  .platform__item .ic{width:15px; height:15px;}
  .platform__item:hover{background:var(--sunk);}
  .platform__item.is-on{color:var(--cyan); background:var(--cyan-bg);}
  /* No JS: the selector is a control, so without a script the reader must
     still be able to reach every platform. The menu opens in place and every
     panel is shown, one after another, rather than one panel and no way to
     the others. */
  .nojs .platform__menu{display:flex; position:static; margin-top:6px;}
  .nojs .panel{display:flex;}

  .panel{display:none; flex-direction:column; gap:18px;}
  .panel.is-on{display:flex; animation:fade .25s ease both;}
  @keyframes fade{from{opacity:0; transform:translateY(4px)}to{opacity:1; transform:none}}

  /* App card: the name, and the app's own mark bleeding off the corner. */
  .apps{display:flex; flex-direction:column; gap:10px;}
  /* Сетка, а не флекс с распорками.
     На флексе распорка и карточка расходились на 30 px: при flex-basis:0
     карточку не дают ужать меньше её боковых полей и рамки, распорке ужиматься
     нечем, и последний неполный ряд выходил шире полного. Колонки решают это
     по построению, и неполный ряд остаётся ровным без единой подпорки. */
  .apps__row{display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px;}
  .app-card{min-width:0; display:flex; align-items:center; gap:8px; height:54px;
    padding:0 14px; border-radius:12px; background:var(--card2); border:1px solid var(--hair2);
    position:relative; overflow:hidden; text-align:left; text-decoration:none; color:inherit;}
  .app-card:hover{border-color:var(--edge-accent2);}
  .app-card__dot{width:6px; height:6px; flex-shrink:0; border-radius:999px; background:var(--warn);}
  .app-card__name{font-size:14px; font-weight:600; line-height:18px; color:var(--snow);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .app-card__glyph{margin-left:auto; display:flex; color:var(--mist); position:relative; z-index:1;}
  .app-card__glyph .ic{width:15px; height:15px;}
  .app-card__mark{position:absolute; right:-12px; top:-14px; width:78px; height:78px;
    opacity:var(--mark-o,.14); color:var(--mark); pointer-events:none;}
  .mrk-big{width:100%; height:100%; display:block;}

  /* Telegram is not an app card and must not read as one: its proxies are its
     own, and they move that one messenger, not the device. */
  .tg-row{display:flex; align-items:center; gap:12px; min-height:62px; padding:10px 14px;
    border-radius:12px; background:var(--card2); border:1px solid var(--hair2);
    position:relative; overflow:hidden;}
  .tg-row__col{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:3px; padding-right:84px;}
  .tg-row__name{font-size:14px; font-weight:600; line-height:18px;}
  .tg-row__note{font-size:12px; line-height:16px; color:var(--mist);}
  .tg-row__mark{position:absolute; right:-10px; top:-14px; width:86px; height:86px;
    opacity:.12; color:var(--mark); pointer-events:none;}
  /* Second level, folded. */
  .all-apps{display:flex; flex-direction:column; gap:16px; padding:18px; border-radius:14px;
    background:var(--sunk); border:1px solid var(--hair2);}
  .all-apps__top{display:flex; flex-direction:column; gap:6px;}
  .all-apps__line{display:flex; align-items:center; gap:10px;}
  .all-apps__title{font-size:15px; font-weight:700; line-height:18px;}
  .all-apps__count{padding:0 8px; height:20px; display:inline-flex; align-items:center;
    border-radius:999px; background:#1A2534; font-family:var(--mono); font-size:11px;
    line-height:14px; color:var(--mist);}
  .all-apps__toggle{margin-left:auto; display:flex; align-items:center; gap:8px;
    font-size:12px; line-height:16px; color:var(--mist);}
  .all-apps__toggle svg{transition:transform .15s;}
  .all-apps__note{font-size:12px; line-height:17px; color:var(--mist);}
  .all-apps__body{display:flex; flex-direction:column; gap:16px;}
  .all-apps:not(.is-open) .all-apps__body{display:none;}
  .all-apps:not(.is-open) .all-apps__toggle svg{transform:rotate(180deg);}
  /* Without a script there is nobody to open it, so it starts open. */
  .nojs .all-apps__body{display:flex;}
  .nojs .all-apps__toggle{display:none;}
  .all-apps__group{display:flex; flex-direction:column; gap:10px;}
  .all-apps__group-title{font-family:var(--mono); font-size:10px; line-height:12px;
    letter-spacing:.14em; color:var(--faint);}
  .all-apps__row{display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px;}
  /* Пустая ячейка сетки. Ширину держит колонка, поэтому распорке нечего
     задавать, но и убирать её из разметки незачем: ряд остаётся читаемым. */
  .spacer{display:block;}

  /* A line that explains rather than offers: used where the short list IS the
     answer, and later where a television cannot do what a phone can. */
  .note-strip{display:flex; align-items:flex-start; gap:12px; padding:16px 18px;
    border-radius:14px; background:var(--sunk); border:1px solid var(--hair2);}
  .note-strip .ic{width:16px; height:16px; color:var(--mist); margin-top:1px;}
  .note-strip__text{flex:1 1 0; min-width:0; font-size:12px; line-height:18px; color:var(--mist);}

  /* Steps */
  .step{display:flex; align-items:flex-start; gap:16px; padding:20px; border-radius:14px;
    background:var(--card2); border:1px solid var(--hair2);}
  .step--highlight{border-color:var(--edge-accent2);}
  .step--warn{background:var(--warn-bg); border-color:var(--warn-edge);}
  .step__num{width:38px; height:38px; flex-shrink:0; border-radius:999px; display:flex;
    align-items:center; justify-content:center;
    background:#0D1F26; border:1px solid var(--edge-accent2); color:var(--cyan);}
  .step__num .ic{width:16px; height:16px;}
  .step__num--ok{background:var(--ok-bg); border-color:var(--ok-edge); color:var(--ok);}
  .step__num--info{background:#0F1A2A; border-color:#2B4A66; color:var(--brand);}
  .step__num--warn{background:#241C10; border-color:#5B4726; color:var(--warn);}
  .step__col{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:9px;}
  .step__title{font-size:15px; font-weight:700; line-height:18px;}
  .step__text{font-size:13px; line-height:20px; color:var(--mist);}
  .step--warn .step__text{color:var(--warn-ink);}
  .step__field{display:flex; flex-direction:column; gap:8px; margin-top:4px; padding:14px 16px;
    border-radius:12px; background:var(--sunk); border:1px solid var(--hair2);}
  .step__field-label{font-family:var(--mono); font-size:10px; line-height:12px;
    letter-spacing:.12em; color:var(--mist);}
  .step__field-value{font-family:var(--mono); font-size:17px; line-height:24px; color:#C8D4E3;
    word-break:break-all; user-select:all;}
  .conf-list{display:flex; flex-direction:column; gap:8px; padding-top:4px;}
  .conf-row{display:flex; align-items:center; gap:12px; min-height:40px; padding:8px 14px;
    border-radius:11px; background:var(--card2); border:1px solid var(--hair2);
    text-align:left; width:100%; text-decoration:none;}
  .conf-row:hover{border-color:var(--edge-accent2);}
  .conf-row__name{flex:1 1 0; min-width:0; font-size:13px; font-weight:500; line-height:16px;
    color:var(--snow); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .conf-row__file{font-family:var(--mono); font-size:12px; line-height:16px; color:var(--mist);}

  .empty{color:var(--mist); font-size:13px; padding:6px 2px;}

  /* Compact import widget: segmented selectors + one QR shown at a time. */
  .segs{display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;}
  .seg{cursor:pointer; background:var(--ground2); border:1px solid var(--hair); color:var(--mist);
    border-radius:8px; padding:7px 13px; font-size:12px; font-family:var(--mono); font-weight:500;
    transition:color .15s, border-color .15s, background .15s;}
  .seg:hover{color:var(--snow);}
  .seg.on{color:var(--ground); background:var(--cyan2); border-color:var(--cyan2);}
  .appsel{margin-top:-6px;}
  /* min-height reserves the QR row so switching target/app never reflows the page. */
  .qrview{display:flex; justify-content:center; min-height:286px;}
  .qrf{display:none; margin:0; flex-direction:column; align-items:center; text-align:center;}
  .qrf.on{display:flex; animation:fade .25s ease both;}
  .qbx{background:#fff; border-radius:12px; padding:11px; line-height:0;
    box-shadow:0 1px 0 rgba(255,255,255,.05), 0 10px 28px rgba(0,0,0,.4);}
  .qbx svg{display:block; width:240px; height:240px;}
  .qrf figcaption{color:var(--mist); font-size:11px; margin-top:10px; font-family:var(--mono);}
  .copyk{display:inline-block; margin-top:10px; cursor:pointer; font-size:12px; font-weight:500; text-decoration:none;
    border:1px solid var(--hair); background:var(--ground2); color:var(--cyan);
    border-radius:8px; padding:7px 14px;}
  .copyk:hover{border-color:var(--cyan2);}
  /* Downloads. The card reuses the "all apps" expander, so it carries no
     machinery of its own; --flat drops the inner plate, which would otherwise
     be a box inside a box. */
  .all-apps--flat{padding:0; background:none; border:0;}
  /* Та же утопленная плашка, что и «все приложения»: блок живёт внутри
     карточки «Установка», а не рядом с ней, в том числе когда выдавать нечего
     и на её месте стоит объяснение. */
  .dl-card{padding:18px; border-radius:14px; background:var(--sunk); border:1px solid var(--hair2);}
  .dl-mark{width:17px; height:17px; color:var(--mist);}
  .note-strip__title{color:var(--snow); font-weight:700;}
  /* Свёрнуто подпись говорит, зачем блок вообще. Раскрыто она уже сказана
     самим списком, и её место занимает то, что нужно ЗДЕСЬ: что значит точка. */
  .all-apps.is-open .dl-note--shut{display:none;}
  .all-apps:not(.is-open) .dl-note--open{display:none;}
  /* Предупреждение про пароли стоит под списком, а не над ним: сверху его
     читают до того, как есть что забирать, и оно превращается в шум. */
  .dl-warn{margin-top:2px;}
  .dl-dead{display:flex; align-items:flex-start; gap:9px; padding:12px 14px; border-radius:12px;
    background:var(--bad-bg); border:1px solid var(--bad-edge); color:var(--bad);
    font-size:12px; line-height:17px;}
  .dl-dead .ic{width:14px; height:14px; margin-top:2px;}
  /* Dimmed, still clickable: the file is the same file, it just will not
     authorise today. */
  .is-dead .dl-row{opacity:.72;}
  .dl-groups{display:flex; flex-direction:column; gap:16px;}
  .dl-group{display:flex; flex-direction:column; gap:8px;}
  .dl-row{display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 14px;
    border-radius:12px; background:var(--card2); border:1px solid var(--hair2);}
  .dl-row__col{flex:1 1 220px; min-width:0; display:flex; flex-direction:column; gap:3px;}
  .dl-row__actions{display:flex; gap:8px; flex-shrink:0;}
  .dl-row__name{display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600;
    line-height:18px; color:var(--snow);}
  .dl-row__note{font-size:12px; line-height:16px; color:var(--mist);}
  .dl-row__note--warn{color:var(--warn);}
  /* Точка отмечает то, что подходит выбранной платформе. Строк это не
     убавляет: место под точку держится всегда, иначе имена дёргались бы влево
     и вправо при каждом переключении платформы. */
  .dl-row__dot{width:6px; height:6px; flex-shrink:0; border-radius:999px; background:transparent;}
  .dl-row.is-fit{background:var(--cyan-bg); border-color:var(--edge-accent);}
  .dl-row.is-fit .dl-row__dot{background:var(--cyan);}
  /* Ровный вид у обеих кнопок, а бирюзу получает только строка, отмеченная
     точкой: акцент на КАЖДОЙ строке перестаёт быть акцентом, а отмечена та,
     что подходит выбранной платформе. Приглушённая кнопка остаётся рабочей,
     это не «выключено». */
  .dl-btn{display:inline-flex; align-items:center; gap:8px; height:34px; padding:0 13px;
    border-radius:10px; background:var(--tile); border:1px solid var(--hair2);
    font-size:13px; font-weight:500; color:#C8D4E3; text-decoration:none; white-space:nowrap;}
  .dl-btn .ic{width:13px; height:13px;}
  .dl-btn--ghost{background:var(--card2); border-color:var(--hair2); color:var(--mist);}
  .dl-row.is-fit .dl-btn:not(.dl-btn--ghost){background:var(--cyan-bg);
    border-color:var(--edge-accent2); color:var(--cyan);}
  .dl-btn:hover{border-color:var(--edge-accent);}
  /* The chosen platform lifts its group to the top and tints its title. It
     never removes a group: taking a config file is what people do FOR another
     device, so hiding by platform hides exactly the row they came for. */
  .dl-group.is-relevant{order:-1;}
  .dl-group.is-relevant .all-apps__group-title{color:var(--cyan);}
  .hint{color:var(--mist); font-size:12px; margin-top:10px;}

  .support{display:block; text-align:center; margin-top:6px; color:var(--cyan); text-decoration:none;
    font-family:var(--mono); font-size:12px;}

  /* Transfer: a window on a desktop, a sheet from the bottom on a phone. The
     top corner is out of thumb reach, and a sheet leaves the page visible
     behind it so it is obvious nothing was navigated away from. */
  .overlay{position:fixed; inset:0; z-index:80; display:none;
    align-items:center; justify-content:center; padding:24px; background:rgba(4,8,13,.78);}
  .overlay.is-open{display:flex;}
  .modal{width:100%; max-width:460px; max-height:calc(100vh - 48px); overflow:auto;
    display:flex; flex-direction:column; gap:18px; padding:26px;
    border-radius:20px; background:var(--card); border:1px solid var(--hair2);}
  .modal__handle{display:none;}
  .modal__head{display:flex; align-items:flex-start; gap:12px;}
  .modal__col{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:7px;}
  .modal__title{font-size:19px; font-weight:600; line-height:24px;}
  .modal__note{font-size:13px; line-height:19px; color:var(--mist);}
  .modal__close{width:32px; height:32px; flex-shrink:0; display:flex; align-items:center;
    justify-content:center; border-radius:9px; background:var(--card2);
    border:1px solid var(--hair); color:var(--mist);}
  .modal__close .ic{width:16px; height:16px;}
  .qr-plate{display:flex; align-items:center; justify-content:center; padding:28px;
    border-radius:16px; background:#E9EEF4;}
  .qr-plate svg{width:300px; height:300px; max-width:100%; display:block;}
  .link-box{display:flex; flex-direction:column; gap:5px; padding:11px 14px; border-radius:12px;
    background:var(--card2); border:1px solid var(--hair);}
  .link-box__label{font-family:var(--mono); font-size:10px; line-height:12px;
    letter-spacing:.09em; color:var(--mist);}
  .link-box__value{font-family:var(--mono); font-size:13px; line-height:17px; color:var(--snow);
    word-break:break-all; user-select:all;}
  .modal__copy{display:flex; align-items:center; justify-content:center; gap:9px; height:44px;
    border-radius:12px; background:#14302F; border:1px solid #2C5C57;
    font-size:14px; font-weight:600; color:var(--cyan);}
  .modal__warn{display:flex; align-items:flex-start; gap:9px; font-size:12px; line-height:17px; color:var(--warn);}
  .modal__warn .ic{width:14px; height:14px; margin-top:2px;}

  /* Foot. The language switch lives here now: it is a once-per-visit decision
     and it was taking the top right corner, where the two buttons belong. Two
     plain links to ?lang=, so switching is a server re-render and needs no JS. */
  .foot{display:flex; justify-content:center; gap:7px; padding:34px 16px 52px;}
  .lang{display:flex; align-items:center; gap:7px; height:38px; padding:0 15px;
    border-radius:999px; background:var(--card2); border:1px solid var(--hair2);}
  .lng{text-decoration:none; color:#C8D4E3; font-size:13px; font-weight:600;
    letter-spacing:.02em; transition:color .15s;}
  .lng:hover{color:var(--snow);}
  .lng.on{color:var(--cyan);}
  .lang__sep{color:var(--faint);}

  /* Staggered load */
  .card,.top{animation:rise .5s ease both;}
  .top{animation-delay:.02s}
  .wrap>.card:nth-of-type(1){animation-delay:.06s}
  .wrap>.card:nth-of-type(2){animation-delay:.10s}
  .wrap>.card:nth-of-type(3){animation-delay:.14s}
  .wrap>.card:nth-of-type(4){animation-delay:.18s}
  .wrap>.card:nth-of-type(5){animation-delay:.22s}
  @keyframes rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
  /* ───── Телефон ─────
     Одна колонка везде, где на широком их четыре или две, и кнопки строки
     уезжают под её текст во всю ширину: на 390 они иначе рвут строку пополам
     и имя формата обрезается на середине слова. */
  @media (max-width:720px){
    .wrap{gap:18px; padding:0 16px;}
    .head{gap:14px; padding:20px 16px 0;}
    .head__title{font-size:17px; line-height:22px;}
    .hbtn{height:34px; border-radius:9px; font-size:12px; gap:7px;}
    .hbtn__full{display:none;}
    .hbtn__short{display:inline;}
    .card{padding:17px; border-radius:16px;}
    .sub-card{gap:16px;}
    .sub-card__head{gap:12px;}
    .sub-card__badge{width:38px; height:38px;}
    .sub-card__name{font-size:17px; line-height:22px;}
    .sub-card__row{flex-direction:column;}
    .tile{height:auto; min-height:66px; padding:11px 13px; gap:5px; border-radius:12px;}
    .tile__value{font-size:14px; line-height:18px;}
    .install__head{flex-wrap:wrap; gap:10px;}
    .install__title{font-size:18px;}
    .apps__row,.all-apps__row{grid-template-columns:minmax(0, 1fr);}
    .app-card{height:50px;}
    .spacer{display:none;}
    /* Иначе «Показать» ломается пополам: заголовку с названием платформы и
       счётчику на 390 не остаётся места, и переключатель ужимается до буквы. */
    .all-apps__line{flex-wrap:wrap;}
    .all-apps__toggle{white-space:nowrap;}
    .tg-row__col{padding-right:70px;}
    .step{padding:16px; gap:12px;}
    .step__num{width:34px; height:34px;}
    .step__field-value{font-size:14px; line-height:20px;}
    .linkrow{flex-direction:column; align-items:stretch; gap:8px;}
    .linkrow .copy{width:100%;}
    .dl-card{padding:14px;}
    .dl-row{align-items:stretch; flex-direction:column; gap:10px; padding:11px 12px;}
    .dl-row__col{flex:0 0 auto;}
    .dl-btn{flex:1 1 0; min-width:0; justify-content:center; height:34px; padding:0 10px;}
    .foot{padding:22px 16px 34px;}
    /* Шторка снизу вместо окна по центру: до верхнего угла большим пальцем не
       дотянуться, а из-под шторки видно, что страница на месте. */
    .overlay{align-items:flex-end; justify-content:center; padding:0;}
    .modal{max-width:none; border-radius:22px 22px 0 0; border-left:0; border-right:0;
      border-bottom:0; padding:10px 20px 26px; gap:16px; align-items:center; max-height:92vh;}
    .modal__handle{display:block; width:38px; height:4px; border-radius:2px;
      background:var(--hair2); flex-shrink:0; margin-bottom:6px;}
    .modal__head,.link-box,.modal__copy,.modal__warn{width:100%;}
    .qr-plate{width:100%; padding:20px;}
    .qr-plate svg{width:262px; height:262px;}
    .modal__title{font-size:17px; line-height:22px;}
  }

  @media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
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
  </section>

  ${
    /* «Забрать конфигом» это последний блок ВНУТРИ «Установки», а не карточка
       под ней: за конфигом идут, когда установка по ссылке не сложилась, и
       искать его надо там же, где инструкция.

       Когда серверов ещё нет, карточка всё равно на месте и со всем
       справочником: исчезала она раньше, и страница из-за этого читалась как
       сломанная, хотя сломаны были данные. Полоса сверху говорит правду, а
       инструкция остаётся: ставить приложение можно и до выдачи доступа. */
    platforms.length > 0
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
<script>
  (function () {
    var SUB_URL = ${JSON.stringify(data.subUrl)};
    var NO_TRANSFER = ${JSON.stringify(NO_TRANSFER)};
    // Copy the subscription link.
    var b = document.getElementById('copy'), i = document.getElementById('url');
    if (b) {
      b.addEventListener('click', function () {
        // Only the words change. The button holds a glyph and two labels (one
        // for the phone), and textContent on the button itself would delete
        // all three and leave a bare word behind.
        var full = b.querySelector('.hbtn__full'), short = b.querySelector('.hbtn__short');
        var done = function () {
          var of = full && full.textContent, os = short && short.textContent;
          if (full) full.textContent = ${JSON.stringify(t.copied)};
          if (short) short.textContent = ${JSON.stringify(t.copied)};
          setTimeout(function () {
            if (full) full.textContent = of;
            if (short) short.textContent = os;
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(SUB_URL).then(done).catch(function () {
            if (i) { i.select(); document.execCommand('copy'); }
            done();
          });
        } else if (i) { i.select(); document.execCommand('copy'); done(); }
        else { done(); }
      });
    }
    // The link card's own button. A plain one: its whole content is the word,
    // so textContent is safe here and would not be on the header button.
    var b2 = document.getElementById('copy-inline');
    if (b2 && i) {
      b2.addEventListener('click', function () {
        i.select();
        var o = b2.textContent;
        var done = function () { b2.textContent = ${JSON.stringify(t.copied)}; setTimeout(function () { b2.textContent = o; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(SUB_URL).then(done).catch(function () { document.execCommand('copy'); done(); });
        } else { document.execCommand('copy'); done(); }
      });
    }
    // Copy AmneziaVPN vpn:// keys (paste into the app "add by key").
    [].slice.call(document.querySelectorAll('.copyk')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key') || '';
        var done = function () { var o = btn.textContent; btn.textContent = ${JSON.stringify(t.copied)}; setTimeout(function () { btn.textContent = o; }, 1500); };
        var fallback = function () { var ta = document.createElement('textarea'); ta.value = key; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); done(); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(key).then(done).catch(fallback); }
        else { fallback(); }
      });
    });
    // Compact import widget: server selector + AmneziaVPN/AmneziaWG toggle,
    // one QR visible at a time. All QR figures are embedded; we just toggle .on.
    (function () {
      var figs = [].slice.call(document.querySelectorAll('.qrf'));
      if (figs.length < 2) return; // single QR, nothing to switch
      var tgBtns = [].slice.call(document.querySelectorAll('.tgsel .seg'));
      var appBtns = [].slice.call(document.querySelectorAll('.appsel .seg'));
      var appSel = document.querySelector('.appsel');
      var onFig = figs.filter(function (f) { return f.classList.contains('on'); })[0] || figs[0];
      var curTarget = onFig.getAttribute('data-target');
      var curApp = 'vpn';
      function isAwg(x) { return !!x && x.indexOf('awg:') === 0; }
      function render() {
        if (appSel) appSel.style.display = isAwg(curTarget) ? '' : 'none';
        figs.forEach(function (f) {
          var show = f.getAttribute('data-target') === curTarget &&
            (!isAwg(curTarget) || f.getAttribute('data-app') === curApp);
          f.classList.toggle('on', show);
        });
        tgBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-target') === curTarget); });
        appBtns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-app') === curApp); });
      }
      tgBtns.forEach(function (b) { b.addEventListener('click', function () { curTarget = b.getAttribute('data-target'); render(); }); });
      appBtns.forEach(function (b) { b.addEventListener('click', function () { curApp = b.getAttribute('data-app'); render(); }); });
      render();
    })();
    // From here on the page is driven by script, so the no-script layout (every
    // panel open, the menu unfolded) can go.
    document.body.classList.remove('nojs');
    // Transfer window.
    var overlay = document.querySelector('[data-transfer]');
    var openBtn = document.querySelector('[data-open-transfer]');
    function closeTransfer() { if (overlay) overlay.classList.remove('is-open'); }
    if (overlay && openBtn) {
      openBtn.addEventListener('click', function (e) { e.stopPropagation(); overlay.classList.add('is-open'); });
      var closeBtn = overlay.querySelector('[data-close-transfer]');
      if (closeBtn) closeBtn.addEventListener('click', closeTransfer);
      // Anywhere outside the panel, and Escape. A modal with one way out is a
      // trap on a phone, where the close button is at the far corner.
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeTransfer(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTransfer(); });
      var mc = overlay.querySelector('[data-copy-modal]');
      if (mc) {
        mc.addEventListener('click', function () {
          var word = mc.querySelector('span');
          var done = function () {
            if (!word) return;
            var o = word.textContent;
            word.textContent = ${JSON.stringify(t.copied)};
            setTimeout(function () { word.textContent = o; }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(SUB_URL).then(done).catch(done);
          else done();
        });
      }
    }
    // Platform selector.
    var picker = document.querySelector('[data-platform-picker]');
    var items = [].slice.call(document.querySelectorAll('.platform__item'));
    var panels = [].slice.call(document.querySelectorAll('.panel'));
    var pickerBtn = picker && picker.querySelector('[data-platform-btn]');
    function show(p) {
      panels.forEach(function (pl) { pl.classList.toggle('is-on', pl.getAttribute('data-platform') === p); });
      items.forEach(function (it) {
        var on = it.getAttribute('data-pick') === p;
        it.classList.toggle('is-on', on);
        it.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && picker) {
          var icon = picker.querySelector('[data-platform-icon]');
          var name = picker.querySelector('[data-platform-name]');
          // Reuse the menu row's own glyph and label: one source for both, so
          // the button can never end up naming a different platform.
          if (icon) icon.innerHTML = it.querySelector('svg').outerHTML;
          if (name) name.textContent = it.querySelector('span').textContent;
        }
      });
      if (picker) picker.classList.remove('is-open');
      if (pickerBtn) pickerBtn.setAttribute('aria-expanded', 'false');
      // No transfer button on a television or a router. Same reason the QR is
      // not offered there: nothing on those devices can read a code, and a
      // button leading to one is a control that cannot be used.
      if (openBtn) openBtn.hidden = NO_TRANSFER.indexOf(p) !== -1;
      if (overlay && NO_TRANSFER.indexOf(p) !== -1) closeTransfer();
      // Downloads: lift the group this platform is about, tint its title, hide
      // nothing. Somebody takes a file FOR another device, so the router rows
      // matter most to the person sitting at a laptop.
      var want = p === 'router' ? 'router' : 'clients';
      [].slice.call(document.querySelectorAll('[data-dl-group]')).forEach(function (g) {
        g.classList.toggle('is-relevant', g.getAttribute('data-dl-group') === want);
      });
      // Точка на строках, которые подходят этой платформе. Число строк при
      // этом не меняется: если счётчик над блоком поедет, значит резка по
      // платформе вернулась, а её тут быть не должно.
      // Отметки не ставятся, пока подписка не действует: сегодня не подойдёт
      // ни одна строка, и подсвечивать там нечего. Гасится здесь, а не
      // каскадом, иначе сброс акцента пришлось бы повторять для точки, для
      // строки и для каждой кнопки.
      var dlDead = !!document.querySelector('#downloads .is-dead');
      [].slice.call(document.querySelectorAll('[data-dl-fits]')).forEach(function (r) {
        var fits = r.getAttribute('data-dl-fits');
        r.classList.toggle('is-fit', !dlDead && !!fits && fits.split(' ').indexOf(p) !== -1);
      });
    }
    if (pickerBtn) {
      pickerBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = picker.classList.toggle('is-open');
        pickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function () { picker.classList.remove('is-open'); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') picker.classList.remove('is-open'); });
    }
    items.forEach(function (it) { it.addEventListener('click', function () { show(it.getAttribute('data-pick')); }); });
    // "Config" puts the BODY of that format in the clipboard, fetched from
    // the same address the download button uses.
    //
    // Fetched rather than embedded, and that is the whole point: a config body
    // carries the login, the keys and the passwords in clear text, so putting
    // it in the markup or in a variable here would leak it into the page
    // source for anyone who opens it or saves it. The request goes to our own
    // origin, so the no-external-requests rule is untouched.
    [].slice.call(document.querySelectorAll('[data-copy-config]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var word = btn.querySelector('span');
        var url = btn.getAttribute('data-copy-config') || '';
        var original = word ? word.textContent : '';
        var say = function (s) { if (word) word.textContent = s; };
        var back = function () { setTimeout(function () { say(original); }, 1500); };
        if (!navigator.clipboard || !navigator.clipboard.writeText || !window.fetch) return;
        fetch(url, { credentials: 'omit' })
          .then(function (r) { return r.text(); })
          .then(function (body) { return navigator.clipboard.writeText(body); })
          .then(function () { say(${JSON.stringify(t.copied)}); back(); })
          // Say nothing false: the label goes back and the reader still has
          // the download button, which needs no clipboard permission at all.
          .catch(function () { say(original); });
      });
    });
    // Second level: one expander per platform panel, each with its own label.
    [].slice.call(document.querySelectorAll('[data-all-apps]')).forEach(function (box) {
      var btn = box.querySelector('[data-toggle-all]');
      if (!btn) return;
      var word = btn.querySelector('span');
      btn.addEventListener('click', function () {
        var open = box.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (word) word.textContent = open ? ${JSON.stringify(t.hideAll)} : ${JSON.stringify(t.showAll)};
      });
    });
    // Pre-select the platform matching the visitor's device, if it is offered.
    var ua = navigator.userAgent || '';
    var guess = null;
    if (/iPhone|iPad|iPod/.test(ua)) guess = 'ios';
    else if (/Android/.test(ua)) guess = /TV|BRAVIA|AFT|SmartTV/.test(ua) ? 'androidtv' : 'android';
    else if (/Macintosh|Mac OS X/.test(ua)) guess = 'macos';
    else if (/Windows/.test(ua)) guess = 'windows';
    else if (/Linux/.test(ua)) guess = 'linux';
    // Показать надо в любом случае, а не только когда UA угадался: панель
    // сервер уже открыл, но отметки в блоке конфигов ставит этот же вызов, и
    // без него читатель с неузнанным UA не увидел бы ни одной точки.
    var known = guess && items.some(function (it) { return it.getAttribute('data-pick') === guess; });
    var first = items[0] && items[0].getAttribute('data-pick');
    if (known) show(guess);
    else if (first) show(first);
  })();
</script>
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
