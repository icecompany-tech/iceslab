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

import type { ProtocolName } from '@iceslab/shared';

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

// 16x16 stroke icons (currentColor), inline so the page stays asset-free.
const PLATFORM_ICONS: Record<PlatformId, string> = {
  ios: '<path d="M11.6 8.3c0-1.5 1.2-2.2 1.3-2.3-.7-1-1.8-1.2-2.2-1.2-.9-.1-1.8.6-2.3.6s-1.2-.6-2-.6c-1 0-2 .6-2.5 1.6-1.1 1.9-.3 4.6.8 6.1.5.7 1.1 1.5 1.9 1.5.8 0 1-.5 2-.5s1.2.5 2 .5 1.3-.7 1.8-1.4c.6-.8.8-1.6.8-1.6s-1.4-.6-1.4-2.2Z"/><path d="M10.1 3.9c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.6 0 1.3-.3 1.7-.8Z"/>',
  android:
    '<path d="M4 8.5A1 1 0 0 1 5 9.5v3a1 1 0 1 1-2 0v-3a1 1 0 0 1 1-1Zm8 0a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0v-3a1 1 0 0 1 1-1Z"/><path d="M5.5 7.5h5a.5.5 0 0 1 .5.5v4.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a.5.5 0 0 1 .5-.5Z"/><path d="M5.3 7.3c.1-1.7 1.3-2.8 2.7-2.8s2.6 1.1 2.7 2.8" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M6.6 5.2 6 4.3m4 .9.6-.9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="6.7" cy="6.4" r=".4"/><circle cx="9.3" cy="6.4" r=".4"/>',
  windows:
    '<path d="M2.5 4.2 7.4 3.5v4.3H2.5V4.2Zm0 4.5h4.9V13l-4.9-.7V8.7Zm5.7-5.3 5.3-.7v5h-5.3V3.4Zm5.3 5.3v5l-5.3-.7V8.7h5.3Z"/>',
  macos:
    '<rect x="2" y="3" width="12" height="8.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M6 13.5h4M8 11.5v2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  linux:
    '<path d="M8 2.5c1.6 0 2.2 1.6 2.2 3 0 1.1.4 1.7 1 2.6.7 1 1.3 1.8 1.3 2.9 0 1.4-1.3 2.5-4.5 2.5S3.5 12.4 3.5 11c0-1.1.6-1.9 1.3-2.9.6-.9 1-1.5 1-2.6 0-1.4.6-3 2.2-3Z" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="7" cy="6" r=".5"/><circle cx="9" cy="6" r=".5"/><path d="M7 7.6c.3.4.7.4 1 0" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>',
  androidtv:
    '<rect x="2" y="3.5" width="12" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M5.5 13.5h5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="m6.5 6 3 1.7-3 1.8V6Z"/>',
  appletv:
    '<rect x="2" y="3.5" width="12" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M5.5 13.5h5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M6.3 6.8h3.4M8 6.8v3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  router:
    '<rect x="2" y="8" width="12" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M5 10.5h.01M7 10.5h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 11.5v-1M8 3.5v4.5M5.7 5.2A3 3 0 0 1 8 4.2a3 3 0 0 1 2.3 1M4.2 3.6A5 5 0 0 1 8 2a5 5 0 0 1 3.8 1.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
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
  | { kind: 'deeplink'; scheme: 'hiddify' | 'streisand' | 'v2rayng' | 'clash' | 'singbox' | 'shadowrocket' }
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
}

const APPS: AppDef[] = [
  // Universal subscription clients (xray / shadowsocks / hysteria via the link).
  {
    name: 'Hiddify',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv'],
    protocols: ['amneziawg', 'xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'hiddify' },
    recommended: true,
  },
  {
    name: 'sing-box',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'singbox' },
  },
  {
    name: 'Streisand',
    platforms: ['ios', 'macos', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'streisand' },
    recommended: true,
  },
  {
    name: 'Shadowrocket',
    platforms: ['ios', 'appletv'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'shadowrocket' },
  },
  {
    name: 'v2rayNG',
    platforms: ['android', 'androidtv'],
    protocols: ['xray', 'shadowsocks'],
    action: { kind: 'deeplink', scheme: 'v2rayng' },
    recommended: true,
  },
  {
    name: 'NekoBox',
    platforms: ['android'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
  },
  {
    name: 'v2rayN',
    platforms: ['windows'],
    protocols: ['xray', 'shadowsocks'],
    action: { kind: 'manual' },
  },
  {
    name: 'Nekoray',
    platforms: ['windows', 'linux'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'manual' },
  },
  {
    name: 'Clash Verge',
    platforms: ['windows', 'macos', 'linux'],
    protocols: ['xray', 'shadowsocks', 'hysteria'],
    action: { kind: 'deeplink', scheme: 'clash' },
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
    name: 'AmneziaVPN',
    platforms: ['ios', 'macos', 'windows', 'linux', 'android', 'androidtv'],
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
    name: 'OpenWrt',
    platforms: ['router'],
    protocols: ['amneziawg', 'xray'],
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
  }
}

interface Labels {
  subtitle: string;
  status: string;
  traffic: string;
  expires: string;
  noExpiry: string;
  unlimited: string;
  protocols: string;
  subLink: string;
  copy: string;
  copied: string;
  copyKey: string;
  subTarget: string;
  setup: string;
  pickPlatform: string;
  recommended: string;
  open: string;
  download: string;
  scanAction: string;
  linkAction: string;
  noApps: string;
  scanTitle: string;
  scanSubHint: string;
  downloadTitle: string;
  downloadHint: string;
  awgConf: string;
  support: string;
  routerLabel: string;
  statusValues: Record<string, string>;
}

const L: Record<'ru' | 'en', Labels> = {
  en: {
    subtitle: 'Your subscription',
    status: 'Status',
    traffic: 'Traffic',
    expires: 'Expires',
    noExpiry: 'no expiry',
    unlimited: 'unlimited',
    protocols: 'Protocols',
    subLink: 'Subscription link',
    copy: 'Copy',
    copied: 'Copied',
    copyKey: 'Copy key',
    subTarget: 'Subscription',
    setup: 'Set up',
    pickPlatform: 'Pick your device, then open or import in an app below.',
    recommended: 'recommended',
    open: 'Open',
    download: 'Config',
    scanAction: 'Scan QR',
    linkAction: 'Use link',
    noApps: 'No ready client for this protocol on this platform. Use another device.',
    scanTitle: 'Scan to add',
    scanSubHint: 'Subscription: scan with Hiddify, v2rayNG, Streisand, etc.',
    downloadTitle: 'Download config',
    downloadHint: 'Direct config files for apps that import from a file.',
    awgConf: 'AmneziaWG (.conf)',
    support: 'Support',
    routerLabel: 'Router',
    statusValues: {
      active: 'active',
      disabled: 'disabled',
      expired: 'expired',
      limited: 'limit reached',
    },
  },
  ru: {
    subtitle: 'Ваша подписка',
    status: 'Статус',
    traffic: 'Трафик',
    expires: 'Истекает',
    noExpiry: 'без срока',
    unlimited: 'безлимит',
    protocols: 'Протоколы',
    subLink: 'Ссылка подписки',
    copy: 'Копировать',
    copied: 'Скопировано',
    copyKey: 'Скопировать ключ',
    subTarget: 'Подписка',
    setup: 'Установка',
    pickPlatform: 'Выберите устройство и откройте или импортируйте в приложении ниже.',
    recommended: 'рекомендуем',
    open: 'Открыть',
    download: 'Конфиг',
    scanAction: 'Скан QR',
    linkAction: 'По ссылке',
    noApps: 'Готового клиента под ваш протокол на этой платформе нет, используйте другое устройство.',
    scanTitle: 'Сканировать',
    scanSubHint: 'Подписка: сканируйте в Hiddify, v2rayNG, Streisand и т.п.',
    downloadTitle: 'Скачать конфиг',
    downloadHint: 'Готовые файлы конфигурации для приложений, импортирующих из файла.',
    awgConf: 'AmneziaWG (.conf)',
    support: 'Поддержка',
    routerLabel: 'Роутер',
    statusValues: {
      active: 'активна',
      disabled: 'отключена',
      expired: 'истекла',
      limited: 'лимит исчерпан',
    },
  },
};

function platformLabel(p: PlatformId, t: Labels): string {
  return p === 'router' ? t.routerLabel : PLATFORM_LABEL[p];
}

// Render the app rows for one platform, given the user's protocols.
function renderApps(
  platform: PlatformId,
  userProtocols: ProtocolName[],
  subUrl: string,
  hasAwg: boolean,
  t: Labels,
): string {
  const protoSet = new Set(userProtocols);
  const apps = APPS.filter(
    (a) =>
      a.platforms.includes(platform) &&
      a.protocols.some((p) => protoSet.has(p)) &&
      (a.action.kind === 'deeplink' || a.action.kind === 'manual' ? true : hasAwg),
  );
  if (apps.length === 0) {
    return `<div class="empty">${esc(t.noApps)}</div>`;
  }
  return apps
    .map((a) => {
      const initial = esc(a.name.replace(/[^A-Za-z0-9]/, '').charAt(0).toUpperCase() || 'A');
      let action: string;
      switch (a.action.kind) {
        case 'deeplink':
          action = `<a class="act primary" href="${esc(deeplinkHref(a.action.scheme, subUrl))}">${esc(t.open)}</a>`;
          break;
        case 'awg-vpn':
        case 'awg-conf':
          action = `<a class="act" href="#scan">${esc(t.scanAction)}</a>`;
          break;
        case 'download':
          action = `<a class="act" href="#downloads">${esc(t.download)}</a>`;
          break;
        case 'manual':
        default:
          action = `<a class="act" href="#sublink">${esc(t.linkAction)}</a>`;
          break;
      }
      const rec = a.recommended
        ? `<span class="rec">${esc(t.recommended)}</span>`
        : '';
      return `<div class="app"><span class="ava">${initial}</span><span class="aname">${esc(a.name)}${rec}</span>${action}</div>`;
    })
    .join('');
}

export function buildSubscriptionPage(data: SubscriptionPageData): string {
  const t = L[data.lang];
  const u = data.user;

  const used = Math.max(0, u.trafficUsedBytes);
  const total = u.trafficLimitBytes;
  const trafficStr =
    total === null || total <= 0
      ? `${fmtBytes(used)} / ${t.unlimited}`
      : `${fmtBytes(used)} / ${fmtBytes(total)}`;
  const trafficPct =
    total !== null && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const expiresStr = u.expireAt ? new Date(u.expireAt).toISOString().slice(0, 10) : t.noExpiry;
  const statusLabel = t.statusValues[u.status] ?? u.status;
  const statusColor =
    u.status === 'active' ? '#A7D8B9' : u.status === 'limited' ? '#F5B14C' : '#E07A5F';

  const awgNodes = data.awgNodes ?? [];
  const multiAwg = awgNodes.length > 1;
  const hasAwg = awgNodes.length > 0;

  const proxyDownloads: { label: string; fmt: string }[] = [
    { label: 'Clash', fmt: 'clash' },
    { label: 'Sing-box', fmt: 'singbox' },
    { label: 'Xray JSON', fmt: 'xrayjson' },
    { label: 'Base64', fmt: 'plain' },
  ];

  // Platform tabs: hide a tab entirely if it has no app for this subscription.
  const platforms = PLATFORM_ORDER.filter(
    (p) => renderApps(p, data.protocols, data.subUrl, hasAwg, t).indexOf('class="app"') !== -1,
  );
  const tabsHtml = platforms
    .map(
      (p, i) =>
        `<button class="tab${i === 0 ? ' on' : ''}" role="tab" data-p="${p}" aria-selected="${i === 0}"><svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">${PLATFORM_ICONS[p]}</svg><span>${esc(platformLabel(p, t))}</span></button>`,
    )
    .join('');
  const panelsHtml = platforms
    .map(
      (p, i) =>
        `<div class="panel${i === 0 ? ' on' : ''}" data-p="${p}" role="tabpanel">${renderApps(p, data.protocols, data.subUrl, hasAwg, t)}</div>`,
    )
    .join('');

  // Per-node AWG .conf downloads + the proxy formats.
  const awgDownloadBtns = awgNodes.map((n) => {
    const label = multiAwg ? `${esc(t.awgConf)} · ${esc(n.nodeName)}` : esc(t.awgConf);
    return `<a class="dl" href="${esc(data.subUrl)}?format=wgconf&node=${encodeURIComponent(n.nodeName)}">${label}</a>`;
  });
  const downloadBtns = [
    ...awgDownloadBtns,
    ...proxyDownloads.map(
      (d) => `<a class="dl" href="${esc(data.subUrl)}?format=${d.fmt}">${esc(d.label)}</a>`,
    ),
  ].join('');

  const protocolChips = data.protocols.map((p) => `<span class="proto">${esc(p)}</span>`).join('');

  // Compact import widget: ONE QR shown at a time. A server selector picks the
  // AmneziaWG node (no more one-tower-of-QRs-per-node sprawl), an AmneziaVPN /
  // AmneziaWG toggle swaps the vpn:// key QR vs the .conf QR, and the proxy
  // subscription QR is just another selectable target. Every QR SVG is embedded
  // once; the inline script shows/hides by (target, app). All SVG is trusted
  // (server-generated), so embedded raw, never escaped.
  const hasProxy = data.protocols.some((p) => p !== 'amneziawg');
  const showSub = !!data.subUrlQrSvg && hasProxy;

  interface ImportTarget {
    id: string;
    label: string;
  }
  const targets: ImportTarget[] = [];
  if (showSub) targets.push({ id: 'sub', label: t.subTarget });
  for (const n of awgNodes) targets.push({ id: `awg:${n.nodeName}`, label: n.nodeName });

  const figures: string[] = [];
  if (showSub) {
    figures.push(
      `<figure class="qrf on" data-target="sub"><div class="qbx">${data.subUrlQrSvg}</div><figcaption>${esc(t.scanSubHint)}</figcaption></figure>`,
    );
  }
  awgNodes.forEach((n, ni) => {
    // The first AWG node's vpn:// QR is the default view when there is no proxy
    // subscription QR to lead with.
    const vpnOn = !showSub && ni === 0 ? ' on' : '';
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
    ? `<div class="segs appsel"${showSub ? ' style="display:none"' : ''} role="tablist"><button class="seg on" data-app="vpn">AmneziaVPN</button><button class="seg" data-app="conf">AmneziaWG</button></div>`
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

  const supportRow = data.supportUrl
    ? `<a class="support" href="${esc(data.supportUrl)}">${esc(t.support)} -&gt;</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="${data.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>${esc(data.brandTitle)}</title>
<style>
  :root{
    --ground:#08101A; --ground2:#0B1622; --card:#0F1A28; --card2:#152233;
    --hair:#1C2A3D; --snow:#C8D4E3; --mist:#7A8BA3; --dim:#5A6B82;
    --cyan:#7DD3FC; --cyan2:#2A93D1; --moss:#A7D8B9;
    --mono:ui-monospace,'SF Mono','Cascadia Code','JetBrains Mono',Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;}
  body{
    background:var(--ground); color:var(--snow); font-family:var(--sans);
    line-height:1.5; -webkit-font-smoothing:antialiased; min-height:100vh;
    padding:32px 16px 64px;
  }
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
  .wrap{max-width:600px; margin:0 auto; display:flex; flex-direction:column; gap:14px;}

  /* Header */
  .top{display:flex; align-items:center; gap:11px; margin-bottom:6px;}
  .mark{
    width:34px; height:34px; border-radius:9px; flex:0 0 auto;
    border:1px solid var(--hair); background:linear-gradient(160deg,var(--card2),var(--card));
    display:grid; place-items:center; color:var(--cyan);
    box-shadow:0 0 0 1px rgba(125,211,252,.06) inset;
  }
  .brand{font-size:19px; font-weight:600; letter-spacing:-.01em; line-height:1.1;}
  .sub{color:var(--mist); font-size:12px; margin-top:2px; font-family:var(--mono);}
  /* Language selector: RU/EN pill, pushed to the header's right edge. Each is
     a plain link to ?lang=, so toggling re-renders the page server-side (no JS).
     The active locale is filled. */
  .lang{margin-left:auto; flex:0 0 auto; display:flex; gap:2px; padding:2px;
    border:1px solid var(--hair); border-radius:9px; background:var(--card);}
  .lng{text-decoration:none; color:var(--mist); font-family:var(--mono); font-weight:600;
    font-size:11px; letter-spacing:.04em; padding:4px 9px; border-radius:7px;
    transition:color .15s, background .15s;}
  .lng:hover{color:var(--snow);}
  .lng.on{color:var(--ground); background:var(--cyan2);}
  .live{display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--moss);
    box-shadow:0 0 0 0 rgba(167,216,185,.5); animation:pulse 2.4s infinite; margin-right:5px; vertical-align:middle;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(167,216,185,.45)}70%{box-shadow:0 0 0 6px rgba(167,216,185,0)}100%{box-shadow:0 0 0 0 rgba(167,216,185,0)}}

  /* Cards */
  .card{
    background:linear-gradient(180deg, rgba(255,255,255,.012), transparent 40%), var(--card);
    border:1px solid var(--hair); border-radius:14px; padding:16px; position:relative;
  }
  .lbl{color:var(--mist); font-family:var(--mono); font-size:10px; text-transform:uppercase;
    letter-spacing:.16em; margin-bottom:12px;}

  /* Status grid */
  .grid{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
  .stat .k{color:var(--mist); font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em;}
  .stat .v{font-size:15px; font-weight:500; margin-top:3px; font-variant-numeric:tabular-nums;}
  .bar{height:5px; background:var(--ground2); border:1px solid var(--hair); border-radius:4px; margin-top:9px; overflow:hidden;}
  .bar>i{display:block; height:100%; background:linear-gradient(90deg,var(--cyan2),var(--cyan));}
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

  /* Platform tabs */
  .tabs{display:flex; gap:4px; overflow-x:auto; padding-bottom:10px; margin:-2px -2px 12px;
    scrollbar-width:none;}
  .tabs::-webkit-scrollbar{display:none;}
  .tab{display:inline-flex; align-items:center; gap:7px; white-space:nowrap; cursor:pointer;
    background:transparent; border:1px solid transparent; color:var(--mist);
    border-radius:9px; padding:8px 12px; font-family:var(--sans); font-size:13px; font-weight:500;
    transition:color .15s, border-color .15s, background .15s;}
  .tab svg{opacity:.85;}
  .tab:hover{color:var(--snow);}
  .tab.on{color:var(--snow); background:var(--card2); border-color:var(--hair);}
  .tab.on svg{color:var(--cyan); opacity:1;}
  .pickhint{color:var(--mist); font-size:12px; margin-bottom:12px;}

  .panel{display:none; flex-direction:column; gap:8px;}
  .panel.on{display:flex; animation:fade .25s ease both;}
  @keyframes fade{from{opacity:0; transform:translateY(4px)}to{opacity:1; transform:none}}
  .app{display:flex; align-items:center; gap:11px; padding:11px 12px; background:var(--ground2);
    border:1px solid var(--hair); border-radius:11px;}
  .ava{flex:0 0 auto; width:28px; height:28px; border-radius:8px; display:grid; place-items:center;
    font-family:var(--mono); font-size:13px; font-weight:600; color:var(--cyan);
    background:var(--card2); border:1px solid var(--hair);}
  .aname{flex:1; min-width:0; font-size:14px; font-weight:500; display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
  .rec{font-family:var(--mono); font-size:9px; text-transform:uppercase; letter-spacing:.1em;
    color:var(--moss); border:1px solid rgba(167,216,185,.3); border-radius:5px; padding:2px 6px;}
  .act{flex:0 0 auto; text-decoration:none; cursor:pointer; font-size:13px; font-weight:500;
    border:1px solid var(--hair); color:var(--cyan); border-radius:8px; padding:7px 13px;
    transition:border-color .15s, background .15s;}
  .act:hover{border-color:var(--cyan2);}
  .act.primary{background:var(--cyan2); color:var(--ground); border-color:var(--cyan2); font-weight:600;}
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
  .dls{display:flex; flex-wrap:wrap; gap:8px;}
  .dl{text-decoration:none; font-size:13px; color:var(--snow); background:var(--ground2);
    border:1px solid var(--hair); border-radius:9px; padding:9px 13px;}
  .dl:hover{border-color:var(--cyan2);}
  .hint{color:var(--mist); font-size:12px; margin-top:10px;}

  .support{display:block; text-align:center; margin-top:6px; color:var(--cyan); text-decoration:none;
    font-family:var(--mono); font-size:12px;}

  /* Staggered load */
  .card,.top{animation:rise .5s ease both;}
  .top{animation-delay:.02s}
  .wrap>.card:nth-of-type(1){animation-delay:.06s}
  .wrap>.card:nth-of-type(2){animation-delay:.10s}
  .wrap>.card:nth-of-type(3){animation-delay:.14s}
  .wrap>.card:nth-of-type(4){animation-delay:.18s}
  .wrap>.card:nth-of-type(5){animation-delay:.22s}
  @keyframes rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="mark"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l7 4v6.5c0 3.4-2.9 6-7 7.5-4.1-1.5-7-4.1-7-7.5V7l7-4z"/><path d="M9 12l2 2 4-4" stroke-linecap="round"/></svg></div>
    <div>
      <div class="brand">${esc(data.brandTitle)}</div>
      <div class="sub"><span class="live"></span>${esc(t.subtitle)} · ${esc(u.username)}</div>
    </div>
    <nav class="lang" aria-label="Language">
      <a class="lng${data.lang === 'ru' ? ' on' : ''}" href="?lang=ru" hreflang="ru"${data.lang === 'ru' ? ' aria-current="true"' : ''}>RU</a>
      <a class="lng${data.lang === 'en' ? ' on' : ''}" href="?lang=en" hreflang="en"${data.lang === 'en' ? ' aria-current="true"' : ''}>EN</a>
    </nav>
  </div>

  <section class="card">
    <div class="grid">
      <div class="stat"><div class="k">${esc(t.status)}</div><div class="v" style="color:${statusColor}">${esc(statusLabel)}</div></div>
      <div class="stat"><div class="k">${esc(t.expires)}</div><div class="v">${esc(expiresStr)}</div></div>
    </div>
    <div style="margin-top:14px">
      <div class="k" style="color:var(--mist);font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.12em">${esc(t.traffic)}</div>
      <div class="v" style="font-size:15px;font-weight:500;margin-top:3px;font-variant-numeric:tabular-nums">${esc(trafficStr)}</div>
      ${total !== null && total > 0 ? `<div class="bar"><i style="width:${trafficPct}%"></i></div>` : ''}
    </div>
    ${protocolChips ? `<div style="margin-top:16px"><div class="lbl" style="margin-bottom:8px">${esc(t.protocols)}</div><div class="protos">${protocolChips}</div></div>` : ''}
  </section>

  <section class="card" id="sublink">
    <div class="lbl">${esc(t.subLink)}</div>
    <div class="linkrow">
      <input class="link" id="url" value="${esc(data.subUrl)}" readonly onclick="this.select()">
      <button class="copy" id="copy">${esc(t.copy)}</button>
    </div>
  </section>

  ${
    platforms.length > 0
      ? `<section class="card">
    <div class="lbl">${esc(t.setup)}</div>
    <div class="pickhint">${esc(t.pickPlatform)}</div>
    <div class="tabs" role="tablist">${tabsHtml}</div>
    <div class="panels">${panelsHtml}</div>
  </section>`
      : ''
  }

  ${scanSection}

  <section class="card" id="downloads">
    <div class="lbl">${esc(t.downloadTitle)}</div>
    <div class="dls">${downloadBtns}</div>
    <div class="hint">${esc(t.downloadHint)}</div>
  </section>

  ${supportRow}
</div>
<script>
  (function () {
    // Copy the subscription link.
    var b = document.getElementById('copy'), i = document.getElementById('url');
    if (b && i) {
      b.addEventListener('click', function () {
        i.select();
        var done = function () { var o = b.textContent; b.textContent = ${JSON.stringify(t.copied)}; setTimeout(function(){ b.textContent = o; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(i.value).then(done).catch(function(){ document.execCommand('copy'); done(); });
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
    // Platform tabs.
    var tabs = [].slice.call(document.querySelectorAll('.tab'));
    var panels = [].slice.call(document.querySelectorAll('.panel'));
    function show(p) {
      tabs.forEach(function (t) { var on = t.getAttribute('data-p') === p; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
      panels.forEach(function (pl) { pl.classList.toggle('on', pl.getAttribute('data-p') === p); });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.getAttribute('data-p')); }); });
    // Pre-select the tab matching the visitor's OS, if present.
    var ua = navigator.userAgent || '';
    var guess = null;
    if (/iPhone|iPad|iPod/.test(ua)) guess = 'ios';
    else if (/Android/.test(ua)) guess = /TV|BRAVIA|AFT|SmartTV/.test(ua) ? 'androidtv' : 'android';
    else if (/Macintosh|Mac OS X/.test(ua)) guess = 'macos';
    else if (/Windows/.test(ua)) guess = 'windows';
    else if (/Linux/.test(ua)) guess = 'linux';
    if (guess && tabs.some(function (t) { return t.getAttribute('data-p') === guess; })) show(guess);
  })();
</script>
</body>
</html>`;
}
