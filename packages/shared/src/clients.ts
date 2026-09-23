import type { SubscriptionFormat } from './transport.js';

/**
 * The client catalog: every app a subscription is handed to, what it sends
 * when it asks for one, and what it should get.
 *
 * ONE LIST. The subscription page's app registry
 * (apps/panel-backend/src/modules/subscription/subscription.page-apps.ts) takes
 * names, platforms and download pages from here, and the User-Agent rules the
 * panel seeds (subscription_response_rules) are generated from CLIENT_RULES
 * below. Before this file the same client was spelt in three places: the page,
 * two seed migrations and nothing that tested either against the strings the
 * apps really send, which is how `clash-verge/...` and Loon as `Decar` ended up
 * on the plain list (docs/plan/delivery-by-client.md, section 5.2).
 *
 * User-Agent samples are the strings as each app builds them, read from its own
 * source (file:line in the comment, clones of 2026-09-23) or, for the closed
 * apps, from the best source there is, named as such. No sample is invented: a
 * client whose string could not be found has none, and says so.
 */

export const PLATFORM_IDS = [
  'ios',
  'android',
  'windows',
  'macos',
  'linux',
  'androidtv',
  'appletv',
  'router',
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface ClientUaSample {
  /** The string with a version filled in, as the app would send it. */
  ua: string;
  /** Where it comes from: repo@commit file:line, a doc URL, or a third party. */
  source: string;
}

export interface ClientDef {
  /** The name people know it by; also what the page shows. */
  name: string;
  platforms: PlatformId[];
  /** The project's own page, one for every platform. Absent when there is no
   *  trustworthy address. */
  site?: string;
  /**
   * What this client should get when it asks without `?format=`. Absent for a
   * client that never fetches a subscription by link (it takes a file or a key),
   * and for a router recipe, which is a person pasting a link by hand.
   */
  format?: SubscriptionFormat;
  uaSamples: ClientUaSample[];
  /** Why there is no sample, when there is none but the client does fetch. */
  uaUnknown?: string;
  /** Request headers the client sends besides User-Agent, from its docs. */
  sendsHeaders?: string[];
  /**
   * What this client cannot take although its format carries it: a gap of the
   * CLIENT, not of the format (FORMAT_DOORS answers for the format).
   */
  limits?: string[];
}

export const CLIENTS = {
  happ: {
    name: 'Happ',
    site: 'https://happ.su',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv', 'appletv'],
    format: 'plain',
    uaSamples: [{ ua: 'Happ/3.13.0', source: 'happ.su/main/dev-docs/hwid-links' }],
    sendsHeaders: ['X-Hwid', 'X-Device-Os', 'X-Ver-Os', 'X-Device-Model', 'X-Device-Locale'],
  },
  v2raytun: {
    name: 'v2RayTun',
    site: 'https://v2raytun.com',
    platforms: ['android'],
    format: 'plain',
    uaSamples: [],
    uaUnknown: 'closed source, no documented User-Agent',
  },
  hiddify: {
    name: 'Hiddify',
    site: 'https://hiddify.com',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    format: 'singbox',
    uaSamples: [
      {
        ua: 'HiddifyNext/2.5.7 (android) like ClashMeta v2ray sing-box',
        source: 'hiddify-app@276a7ef lib/core/model/app_info_entity.dart:20',
      },
      {
        // "Use xray core when possible" swaps the name in.
        ua: 'HiddifyNextX/2.5.7 (android) like ClashMeta v2ray sing-box',
        source: 'hiddify-app@276a7ef lib/features/profile/data/profile_parser.dart:163-164',
      },
    ],
  },
  singbox: {
    name: 'sing-box',
    site: 'https://github.com/SagerNet/sing-box/releases',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'appletv'],
    format: 'singbox',
    uaSamples: [
      {
        ua: 'SFA (sing-box 1.13.14; language ru_RU)',
        source: 'sing-box-for-android@173a72b app/src/main/java/io/nekohasekai/sfa/utils/HTTPClient.kt:10-16',
      },
      {
        ua: 'SFI (sing-box 1.13.14; language ru_RU)',
        source: 'sing-box-for-apple@64470f9 Library/Network/HTTPClient.swift:5-12, Library/Shared/Variant.swift:12',
      },
      {
        ua: 'SFM (sing-box 1.13.14; language ru_RU)',
        source: 'sing-box-for-apple@64470f9 Library/Shared/Variant.swift:14',
      },
      {
        ua: 'SFT (sing-box 1.13.14; language ru_RU)',
        source: 'sing-box-for-apple@64470f9 Library/Shared/Variant.swift:16',
      },
    ],
  },
  karing: {
    name: 'Karing',
    site: 'https://karing.app',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv', 'appletv'],
    format: 'singbox',
    uaSamples: [],
    uaUnknown:
      'the person picks a UA from a compatibility list (karing@436b431 ' +
      'lib/screens/add_profile_by_link_or_content_screen.dart:80, 502-504); HttpUtils is not in the public repo',
  },
  streisand: {
    name: 'Streisand',
    site: 'https://apps.apple.com/app/id6450534064',
    platforms: ['ios', 'macos'],
    format: 'plain',
    uaSamples: [],
    uaUnknown: 'closed source, no documented User-Agent',
  },
  shadowrocket: {
    name: 'Shadowrocket',
    site: 'https://apps.apple.com/app/id932747118',
    platforms: ['ios', 'macos', 'appletv'],
    format: 'plain',
    uaSamples: [
      {
        ua: 'Shadowrocket/2070 CFNetwork/1498.700.2 Darwin/23.6.0',
        source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Shadowrocket"; the rest of the string is illustrative',
      },
    ],
  },
  v2rayng: {
    name: 'v2rayNG',
    site: 'https://github.com/2dust/v2rayNG/releases',
    platforms: ['android'],
    format: 'xrayjson',
    uaSamples: [
      { ua: 'v2rayNG/1.10.24', source: 'v2rayNG@bd21bbc app/src/main/java/com/v2ray/ang/util/HttpUtil.kt:154-158' },
    ],
  },
  nekobox: {
    name: 'NekoBox',
    site: 'https://github.com/MatsuriDayo/NekoBoxForAndroid/releases',
    platforms: ['android'],
    // It asks for this in its own User-Agent.
    format: 'clash',
    uaSamples: [
      {
        ua: 'NekoBox/Android/1.4.2 (Prefer ClashMeta Format)',
        source: 'NekoBoxForAndroid@5768494 app/src/main/java/io/nekohasekai/sagernet/ktx/Nets.kt:66',
      },
    ],
  },
  v2rayn: {
    name: 'v2rayN',
    site: 'https://github.com/2dust/v2rayN/releases',
    platforms: ['windows'],
    format: 'xrayjson',
    uaSamples: [
      {
        ua: 'v2rayN/7.16.3',
        source: 'v2rayN@e1cb99c v2rayN/ServiceLib/Services/DownloadService.cs:277-279, Common/Utils.cs:906',
      },
    ],
  },
  throne: {
    name: 'Throne',
    site: 'https://github.com/throneproj/Throne/releases',
    platforms: ['windows', 'linux', 'macos'],
    format: 'singbox',
    uaSamples: [{ ua: 'Throne/1.0.9', source: 'Throne@9f56fb9 src/database/SettingsRepo.cpp:355-364' }],
  },
  clashVerge: {
    name: 'Clash Verge',
    site: 'https://github.com/clash-verge-rev/clash-verge-rev/releases',
    platforms: ['windows', 'macos', 'linux'],
    format: 'clash',
    uaSamples: [
      { ua: 'clash-verge/v2.4.3', source: 'clash-verge-rev@afc32f5 src-tauri/src/utils/network.rs:247-253' },
    ],
  },
  flclash: {
    name: 'FlClash',
    site: 'https://github.com/chen08209/FlClash/releases',
    platforms: ['android', 'windows', 'macos', 'linux'],
    format: 'clash',
    uaSamples: [
      {
        ua: 'FlClash/v0.8.90 clash-verge Platform/android',
        source: 'FlClash@c7be702 lib/common/package.dart:8-12',
      },
    ],
  },
  clashMetaAndroid: {
    name: 'Clash Meta for Android',
    site: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases',
    platforms: ['android'],
    format: 'clash',
    uaSamples: [
      {
        ua: 'ClashMetaForAndroid/2.11.17',
        source: 'ClashMetaForAndroid@559594d core/src/main/golang/native/config/fetch.go:42',
      },
    ],
  },
  stash: {
    name: 'Stash',
    platforms: ['ios', 'macos', 'appletv'],
    format: 'clash',
    uaSamples: [
      {
        ua: 'Stash/3.1.1',
        source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Stash"; the version is illustrative',
      },
    ],
    limits: [
      'no ShadowTLS among its proxy types (stash.wiki/en/proxy-protocols/proxy-types), although the clash format carries it',
    ],
  },
  surge: {
    name: 'Surge',
    site: 'https://nssurge.com',
    platforms: ['ios', 'macos'],
    format: 'surge',
    uaSamples: [
      { ua: 'Surge iOS/3090', source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Surge"' },
      { ua: 'Surge Mac/2708', source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Surge Mac"' },
    ],
  },
  surfboard: {
    name: 'Surfboard',
    platforms: ['android'],
    format: 'surge',
    uaSamples: [
      { ua: 'Surfboard/2.24.0', source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Surfboard"' },
    ],
  },
  quantumultx: {
    name: 'Quantumult X',
    platforms: ['ios', 'macos'],
    format: 'quantumultx',
    uaSamples: [
      {
        // The space is URL-encoded in the header.
        ua: 'Quantumult%20X/1.5.2',
        source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Quantumult%20X"',
      },
    ],
  },
  loon: {
    name: 'Loon',
    site: 'https://nsloon.app',
    platforms: ['ios', 'macos', 'appletv'],
    format: 'loon',
    uaSamples: [
      { ua: 'Loon/3.2.4', source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Loon"' },
      { ua: 'Decar/3.2.4', source: 'third party: Sub-Store backend/src/utils/user-agent.js matches "Decar" as Loon' },
    ],
    limits: [
      'hysteria2 port hopping (server-ports, hop-interval: nsloon.app/en/docs/Node/) is not written by our loon builder yet',
    ],
  },
  outline: {
    name: 'Outline',
    site: 'https://getoutline.org',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    format: 'outline',
    // The only UA it would send on a dynamic key is Go's default: outline-apps
    // client/go/outline/fetch.go:31-35 fetches with a bare http.Client.
    uaSamples: [],
    uaUnknown:
      "fetches a dynamic key with Go's default client (outline-apps client/go/outline/fetch.go:31-35): " +
      'Go-http-client, nothing to tell it by; its own "Outline (...)" string is used for websocket configs only',
  },
  foxray: {
    name: 'FoXray',
    platforms: ['ios', 'macos'],
    format: 'xrayjson',
    uaSamples: [],
    uaUnknown: 'closed source, no documented User-Agent',
  },
  v2box: {
    name: 'V2Box',
    platforms: ['ios', 'macos', 'android'],
    format: 'plain',
    uaSamples: [],
    uaUnknown: 'closed source, no documented User-Agent',
  },
  incy: {
    name: 'INCY',
    site: 'https://incy.app',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv', 'appletv'],
    uaSamples: [],
    uaUnknown: 'not researched yet',
  },
  amneziavpn: {
    name: 'AmneziaVPN',
    site: 'https://amnezia.org',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    // Imports a vpn:// key or a file; never fetches a subscription by link
    // (amnezia-client@94b51df core/controllers/selfhosted/importController.cpp:176-259).
    uaSamples: [],
  },
  amneziawg: {
    name: 'AmneziaWG',
    site: 'https://github.com/amnezia-vpn/amneziawg-tools',
    platforms: ['ios', 'android'],
    uaSamples: [],
    uaUnknown: 'imports a .conf file or QR; whether it fetches by link is not verified',
  },
  wgQuick: { name: 'wg-quick / awg', platforms: ['linux', 'router'], uaSamples: [] },
  keenetic: { name: 'Keenetic', platforms: ['router'], uaSamples: [] },
  openwrt: { name: 'OpenWrt', platforms: ['router'], uaSamples: [] },
  xkeen: { name: 'XKeen / Entware', platforms: ['router'], format: 'xkeen', uaSamples: [] },
} as const satisfies Record<string, ClientDef>;

export type ClientId = keyof typeof CLIENTS;

/**
 * The User-Agent rules the panel seeds, in the order they are tried (priority
 * ASC, first match wins). One rule may serve several clients (every Clash-core
 * app shares one), so rules are their own list and each names the clients it is
 * for; the test beside the catalog checks that every sample lands on its
 * client's `format` through these rules, in this order.
 *
 * A pattern is a JavaScript regex; a leading `(?i)` is turned into the `i` flag
 * by the matcher (srr.service.ts).
 *
 * Changing a rule here is a migration: the rows are seeded into the database,
 * where an operator may edit them. See the latest seed migration's header for
 * how a seeded row is told apart from an edited one.
 */
export interface ClientRule {
  name: string;
  pattern: string;
  format: SubscriptionFormat;
  priority: number;
  clients: ClientId[];
}

export const CLIENT_RULES: ClientRule[] = [
  { name: 'Hiddify', pattern: 'Hiddify', format: 'singbox', priority: 10, clients: ['hiddify'] },
  // Before Clash: its UA says "Prefer ClashMeta Format", and gets exactly that.
  { name: 'NekoBox/NekoRay', pattern: 'NekoBox|NekoRay', format: 'clash', priority: 20, clients: ['nekobox'] },
  { name: 'sing-box', pattern: 'sing-box|SFI|SFA|SFM|SFT', format: 'singbox', priority: 30, clients: ['singbox'] },
  // Case-insensitive now: Clash Verge Rev sends `clash-verge/...` in lower case
  // and matched nothing under the old case-sensitive `Clash`.
  {
    name: 'Clash',
    pattern: '(?i)clash|mihomo',
    format: 'clash',
    priority: 40,
    clients: ['clashVerge', 'flclash', 'clashMetaAndroid'],
  },
  // Its own rule: the old `stash` sat inside the Clash rule in lower case, and
  // the app sends `Stash`.
  { name: 'Stash', pattern: '(?i)stash', format: 'clash', priority: 45, clients: ['stash'] },
  { name: 'v2rayN', pattern: 'v2rayN|v2rayNG', format: 'xrayjson', priority: 50, clients: ['v2rayn', 'v2rayng'] },
  // No AmneziaWG client fetches by link (see CLIENTS.amneziavpn); the rule stays
  // because operators have had it since the first seed.
  { name: 'AmneziaWG-app', pattern: '(?i)amneziavpn|amneziawg|wireguard', format: 'wgconf', priority: 60, clients: [] },
  { name: 'Karing', pattern: '(?i)karing', format: 'singbox', priority: 100, clients: ['karing'] },
  { name: 'Throne', pattern: '(?i)throne', format: 'singbox', priority: 110, clients: ['throne'] },
  { name: 'FoXray', pattern: '(?i)foxray', format: 'xrayjson', priority: 120, clients: ['foxray'] },
  { name: 'Surfboard', pattern: '(?i)surfboard', format: 'surge', priority: 130, clients: ['surfboard'] },
  { name: 'Surge', pattern: '(?i)surge', format: 'surge', priority: 140, clients: ['surge'] },
  { name: 'Quantumult X', pattern: '(?i)quantumult', format: 'quantumultx', priority: 150, clients: ['quantumultx'] },
  // Loon also introduces itself as Decar.
  { name: 'Loon', pattern: '(?i)loon|decar', format: 'loon', priority: 160, clients: ['loon'] },
  { name: 'Outline', pattern: '(?i)outline', format: 'outline', priority: 170, clients: ['outline'] },
  { name: 'XKeen', pattern: '(?i)xkeen', format: 'xkeen', priority: 180, clients: ['xkeen'] },
  { name: 'Shadowrocket', pattern: '(?i)shadowrocket', format: 'plain', priority: 200, clients: ['shadowrocket'] },
  { name: 'Streisand', pattern: '(?i)streisand', format: 'plain', priority: 210, clients: ['streisand'] },
  { name: 'V2Box', pattern: '(?i)v2box', format: 'plain', priority: 220, clients: ['v2box'] },
  { name: 'Happ', pattern: '(?i)happ', format: 'plain', priority: 230, clients: ['happ'] },
  { name: 'Default', pattern: '.*', format: 'plain', priority: 900, clients: [] },
];
