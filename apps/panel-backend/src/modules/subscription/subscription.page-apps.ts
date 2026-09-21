/**
 * Что за приложения предлагает страница и чем каждое умеет открыть подписку.
 *
 * Отдельным файлом, потому что это справочник, а не рендер: платформы,
 * реестр клиентов с их протоколами и адресами, и сборка deeplink. Меняется
 * он от внешнего мира (приложение вышло, исчезло из магазина, сменило схему
 * импорта), а не от того, как страница выглядит, и держать его рядом с
 * версткой значило открывать две тысячи строк ради одной записи.
 *
 * Комментарии у записей это проверки по вендорским страницам с датами, они
 * дороже самих строк: не удаляйте их вместе с правкой.
 */
import type { ProtocolName } from '@iceslab/shared';
import type { GlyphKey } from './subscription.page-icons.js';

export type PlatformId =
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
export const PLATFORM_GLYPH: Record<PlatformId, GlyphKey> = {
  ios: 'AppleIcon',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Ubuntu',
  androidtv: 'pf-androidtv',
  appletv: 'pf-appletv',
  router: 'pf-router',
};

export const PLATFORM_ORDER: PlatformId[] = [
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
export const PLATFORM_LABEL: Record<PlatformId, string> = {
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

export type AppAction =
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

export interface AppDef {
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
  /**
   * Куда идти за самим приложением.
   *
   * Официальный источник проекта, один на все платформы: магазинные
   * идентификаторы у половины этих клиентов меняются и угаданный id ведёт на
   * пустую страницу, а страница проекта сама раскладывает по магазинам. Нет
   * достоверного адреса, поле пустое, и шаг остаётся без кнопки: отправить
   * человека в никуда хуже, чем не отправить никуда.
   */
  site?: string;
}

export const APPS: AppDef[] = [
  // Happ and v2RayTun first: these are the clients the operator's own
  // subscribers are already on, and until now the page offered neither, so the
  // most common reader of this page was told to copy a link by hand while
  // every other app got a button.
  {
    // Vendor requirements page, checked 2026-09-21: iOS 15+, Android 5+,
    // Windows 10 (1809)+/11, macOS 13+, Linux, "Android TV 5.0+" and
    // "Apple TV (tvOS 15+)". Linux was missing here and is theirs.
    name: 'Happ',
    site: 'https://happ.su',
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
    site: 'https://v2raytun.com',
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
    site: 'https://hiddify.com',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    protocols: ['amneziawg', 'xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'hiddify' },
    recommended: true,
  },
  {
    // sing-box.sagernet.org/clients lists the Apple client as
    // "iOS/macOS/Apple tvOS", so tvOS was simply missing here.
    name: 'sing-box',
    site: 'https://github.com/SagerNet/sing-box/releases',
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
    site: 'https://karing.app',
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
    site: 'https://apps.apple.com/app/id6450534064',
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
    site: 'https://apps.apple.com/app/id932747118',
    platforms: ['ios', 'macos', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'shadowrocket' },
  },
  {
    // No androidtv: the launcher activity carries no LEAN_BACK_LAUNCHER, so the
    // app does not appear in a TV's app list at all (v2rayNG #1848, unanswered).
    // That is why a separate Android-TV fork exists.
    name: 'v2rayNG',
    site: 'https://github.com/2dust/v2rayNG/releases',
    platforms: ['android'],
    protocols: ['xray', 'shadowsocks'],
    action: { kind: 'deeplink', scheme: 'v2rayng' },
    recommended: true,
  },
  {
    name: 'NekoBox',
    site: 'https://github.com/MatsuriDayo/NekoBoxForAndroid/releases',
    platforms: ['android'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
    advanced: true,
  },
  {
    name: 'v2rayN',
    site: 'https://github.com/2dust/v2rayN/releases',
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
    site: 'https://github.com/throneproj/Throne/releases',
    platforms: ['windows', 'linux', 'macos'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
    advanced: true,
  },
  {
    name: 'Clash Verge',
    site: 'https://github.com/clash-verge-rev/clash-verge-rev/releases',
    platforms: ['windows', 'macos', 'linux'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'clash' },
    advanced: true,
  },
  {
    name: 'FlClash',
    site: 'https://github.com/chen08209/FlClash/releases',
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
    // incy.app раскладывает по магазинам сама: App Store id6756943388, Google
    // Play llc.itdev.incy и релизы INCY-DEV/incy-platforms для десктопа и ТВ.
    // Отдаём одну страницу, а не три ссылки: так читателю не надо выбирать
    // магазин за свою платформу, и нам не надо следить за тремя адресами.
    site: 'https://incy.app',
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
    site: 'https://amnezia.org',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    protocols: ['amneziawg'],
    action: { kind: 'awg-vpn' },
    recommended: true,
  },
  {
    name: 'AmneziaWG',
    site: 'https://github.com/amnezia-vpn/amneziawg-tools',
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

export function deeplinkHref(
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
