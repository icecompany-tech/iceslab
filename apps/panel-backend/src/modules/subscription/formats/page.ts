// Human-readable HTML landing page for a subscription token.
//
// Wave-14 #6 (issue #1): opening a /sub/<token> link in a BROWSER previously
// fell through to `plain` and dumped raw base64 at the user. VPN clients want
// that; humans want buttons. The route serves this page when the request
// looks like a browser navigation (Accept: text/html, no explicit ?format).
//
// Self-contained: inline CSS, no external assets, no JS deps. One tiny inline
// script for the copy-to-clipboard button. Everything interpolated from
// admin/user input is HTML-escaped (esc) — brandTitle and username are
// admin-controlled but defence-in-depth is free.

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
  /** Pre-rendered QR SVG markup (generated server-side, trusted, embedded
   *  raw). Slice 2 / wave-14 #6. `subUrl` QR is the "scan to import the
   *  whole subscription" code for proxy clients; `awg` QR encodes the
   *  wg-quick config text for scanning into AmneziaVPN directly. Either may
   *  be omitted (e.g. no AWG endpoint, or QR generation failed). */
  subUrlQrSvg?: string;
  /** One entry per AmneziaWG node, each with its two QRs: the AmneziaVPN
   *  "vpn://" key (for the AmneziaVPN app) and the native .conf (for the
   *  AmneziaWG app). wg-quick / vpn:// are single-tunnel-per-key, so a user with
   *  several AWG servers gets one labelled QR pair per server instead of just
   *  the first node's. */
  awgNodes?: Array<{ nodeName: string; confQrSvg?: string; vpnQrSvg?: string }>;
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
  importTitle: string;
  importHint: string;
  downloadTitle: string;
  downloadHint: string;
  awgConf: string;
  support: string;
  scanTitle: string;
  scanSubHint: string;
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
    importTitle: 'Add to your app',
    importHint: 'Tap a button if the app is installed, or copy the link above and paste it into the app manually.',
    downloadTitle: 'Download config',
    downloadHint: 'Direct config files for apps that import from a file.',
    awgConf: 'AmneziaWG (.conf)',
    support: 'Support',
    scanTitle: 'Scan to add',
    scanSubHint: 'Subscription: scan with Hiddify, v2rayNG, Streisand, etc.',
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
    importTitle: 'Добавить в приложение',
    importHint: 'Нажмите кнопку, если приложение установлено, либо скопируйте ссылку выше и вставьте в приложение вручную.',
    downloadTitle: 'Скачать конфиг',
    downloadHint: 'Готовые файлы конфигурации для приложений, импортирующих из файла.',
    awgConf: 'AmneziaWG (.conf)',
    support: 'Поддержка',
    scanTitle: 'Сканировать',
    scanSubHint: 'Подписка: сканируйте в Hiddify, v2rayNG, Streisand и т.п.',
    statusValues: {
      active: 'активна',
      disabled: 'отключена',
      expired: 'истекла',
      limited: 'лимит исчерпан',
    },
  },
};

// Deep-link import buttons. Schemes verified de-facto across these clients;
// the always-works fallback is the copy-link button above. URL is passed raw
// for the `://import/<url>` family and percent-encoded for the query family.
function importButtons(subUrl: string): { label: string; href: string }[] {
  const enc = encodeURIComponent(subUrl);
  return [
    { label: 'Hiddify', href: `hiddify://import/${subUrl}` },
    { label: 'Streisand', href: `streisand://import/${subUrl}` },
    { label: 'v2rayNG', href: `v2rayng://install-sub?url=${enc}` },
    { label: 'Clash / Mihomo', href: `clash://install-config?url=${enc}` },
  ];
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

  const expiresStr = u.expireAt
    ? new Date(u.expireAt).toISOString().slice(0, 10)
    : t.noExpiry;

  const statusLabel = t.statusValues[u.status] ?? u.status;
  const statusColor =
    u.status === 'active' ? '#A7D8B9' : u.status === 'limited' ? '#F5B14C' : '#E07A5F';

  const awgNodes = data.awgNodes ?? [];
  const multiAwg = awgNodes.length > 1;
  const hasXray = data.protocols.includes('xray');
  const hasSs = data.protocols.includes('shadowsocks');
  const proxyDownloads: { label: string; fmt: string }[] = [
    { label: 'Clash', fmt: 'clash' },
    { label: 'Sing-box', fmt: 'singbox' },
    { label: 'Xray JSON', fmt: 'xrayjson' },
    // XKeen (xray-core on Keenetic routers) - only useful when an xray endpoint
    // exists (it emits xray outbounds + routing for the router's confdir).
    ...(hasXray ? [{ label: 'XKeen', fmt: 'xkeen' }] : []),
    // Outline / SIP008 is Shadowsocks-only.
    ...(hasSs ? [{ label: 'Outline', fmt: 'outline' }] : []),
    // iOS proxy-line formats - shown when there's any proxy endpoint to carry.
    ...(hasXray || hasSs
      ? [
          { label: 'Surge', fmt: 'surge' },
          { label: 'Quantumult X', fmt: 'quantumultx' },
          { label: 'Loon', fmt: 'loon' },
        ]
      : []),
    { label: 'Base64', fmt: 'plain' },
  ];

  const importBtns = importButtons(data.subUrl)
    .map(
      (b) =>
        `<a class="btn" href="${esc(b.href)}">${esc(b.label)}</a>`,
    )
    .join('');

  // One .conf download per AWG node, pinned with &node= so a multi-AWG user can
  // grab each server's tunnel (the node name is shown only when there's >1).
  const awgDownloadBtns = awgNodes.map((n) => {
    const label = multiAwg ? `${esc(t.awgConf)} · ${esc(n.nodeName)}` : esc(t.awgConf);
    return `<a class="btn dl" href="${esc(data.subUrl)}?format=wgconf&node=${encodeURIComponent(n.nodeName)}">${label}</a>`;
  });
  const downloadBtns = [
    ...awgDownloadBtns,
    ...proxyDownloads.map(
      (d) =>
        `<a class="btn dl" href="${esc(data.subUrl)}?format=${d.fmt}">${esc(d.label)}</a>`,
    ),
  ].join('');

  const protocolChips = data.protocols
    .map((p) => `<span class="chip">${esc(p)}</span>`)
    .join('');

  const supportRow = data.supportUrl
    ? `<a class="support" href="${esc(data.supportUrl)}">${esc(t.support)} →</a>`
    : '';

  // QR SVGs are generated server-side by us (trusted markup), embedded raw.
  // Never escape them - they are SVG, not user input.
  const qrCards: string[] = [];
  if (data.subUrlQrSvg) {
    qrCards.push(
      `<div class="qr"><div class="qrbox">${data.subUrlQrSvg}</div><div class="hint">${esc(t.scanSubHint)}</div></div>`,
    );
  }
  // Per AWG node: the AmneziaVPN vpn:// QR (flagship app) and the native .conf
  // QR (AmneziaWG app). Captioned by app + node name so a multi-AWG user picks
  // the right server. The node suffix is dropped when there's a single node.
  for (const n of awgNodes) {
    const suffix = multiAwg ? ` · ${esc(n.nodeName)}` : '';
    if (n.vpnQrSvg) {
      qrCards.push(
        `<div class="qr"><div class="qrbox">${n.vpnQrSvg}</div><div class="hint">AmneziaVPN${suffix}</div></div>`,
      );
    }
    if (n.confQrSvg) {
      qrCards.push(
        `<div class="qr"><div class="qrbox">${n.confQrSvg}</div><div class="hint">AmneziaWG${suffix}</div></div>`,
      );
    }
  }
  const scanCard =
    qrCards.length > 0
      ? `<div class="card"><div class="label">${esc(t.scanTitle)}</div><div class="qrs">${qrCards.join('')}</div></div>`
      : '';

  return `<!DOCTYPE html>
<html lang="${data.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(data.brandTitle)}</title>
<style>
  :root {
    --ground:#08101A; --card:#0F1A28; --hair:#1C2A3D;
    --snow:#C8D4E3; --mist:#7A8BA3; --cyan:#7DD3FC; --accent:#7DD3FC;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--ground); color:var(--snow);
    font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    line-height:1.5; padding:24px 16px;
  }
  .wrap { max-width:560px; margin:0 auto; }
  .brand { font-size:20px; font-weight:600; letter-spacing:-0.01em; }
  .sub { color:var(--mist); font-size:13px; margin-top:2px; }
  .card {
    background:var(--card); border:1px solid var(--hair); border-radius:12px;
    padding:16px; margin-top:16px;
  }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .stat .k { color:var(--mist); font-size:11px; text-transform:uppercase; letter-spacing:0.08em; }
  .stat .v { font-size:15px; font-weight:500; margin-top:2px; }
  .bar { height:6px; background:var(--hair); border-radius:3px; margin-top:8px; overflow:hidden; }
  .bar > i { display:block; height:100%; background:var(--cyan); }
  .label { color:var(--mist); font-size:11px; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px; }
  .hint { color:var(--mist); font-size:12px; margin-top:8px; }
  .linkrow { display:flex; gap:8px; }
  input.link {
    flex:1; background:var(--ground); border:1px solid var(--hair); color:var(--snow);
    border-radius:8px; padding:10px 12px; font-family:ui-monospace,Menlo,monospace; font-size:12px;
  }
  .btns { display:flex; flex-wrap:wrap; gap:8px; }
  .btn {
    display:inline-block; text-decoration:none; cursor:pointer;
    background:var(--ground); border:1px solid var(--hair); color:var(--cyan);
    border-radius:8px; padding:10px 14px; font-size:13px; font-weight:500;
  }
  .btn:hover { border-color:var(--cyan); }
  .btn.dl { color:var(--snow); }
  #copy { background:var(--cyan); color:var(--ground); border:none; font-weight:600; }
  .chip {
    display:inline-block; background:var(--ground); border:1px solid var(--hair);
    color:var(--mist); border-radius:6px; padding:3px 8px; font-size:11px; margin:0 4px 4px 0;
    text-transform:uppercase; letter-spacing:0.06em;
  }
  .support { display:inline-block; margin-top:16px; color:var(--cyan); text-decoration:none; font-size:13px; }
  .qrs { display:flex; flex-wrap:wrap; gap:16px; }
  .qr { flex:1; min-width:160px; text-align:center; }
  .qrbox { background:#fff; border-radius:8px; padding:10px; display:inline-block; }
  .qrbox svg { display:block; width:160px; height:160px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">${esc(data.brandTitle)}</div>
  <div class="sub">${esc(t.subtitle)} · ${esc(u.username)}</div>

  <div class="card">
    <div class="grid">
      <div class="stat"><div class="k">${esc(t.status)}</div><div class="v" style="color:${statusColor}">${esc(statusLabel)}</div></div>
      <div class="stat"><div class="k">${esc(t.expires)}</div><div class="v">${esc(expiresStr)}</div></div>
    </div>
    <div style="margin-top:12px">
      <div class="k" style="color:var(--mist);font-size:11px;text-transform:uppercase;letter-spacing:0.08em">${esc(t.traffic)}</div>
      <div class="v" style="font-size:15px;font-weight:500;margin-top:2px">${esc(trafficStr)}</div>
      ${total !== null && total > 0 ? `<div class="bar"><i style="width:${trafficPct}%"></i></div>` : ''}
    </div>
    ${protocolChips ? `<div style="margin-top:14px"><div class="label">${esc(t.protocols)}</div>${protocolChips}</div>` : ''}
  </div>

  <div class="card">
    <div class="label">${esc(t.subLink)}</div>
    <div class="linkrow">
      <input class="link" id="url" value="${esc(data.subUrl)}" readonly onclick="this.select()">
      <button class="btn" id="copy">${esc(t.copy)}</button>
    </div>
  </div>

  ${scanCard}

  <div class="card">
    <div class="label">${esc(t.importTitle)}</div>
    <div class="btns">${importBtns}</div>
    <div class="hint">${esc(t.importHint)}</div>
  </div>

  <div class="card">
    <div class="label">${esc(t.downloadTitle)}</div>
    <div class="btns">${downloadBtns}</div>
    <div class="hint">${esc(t.downloadHint)}</div>
  </div>

  ${supportRow}
</div>
<script>
  (function () {
    var b = document.getElementById('copy');
    var i = document.getElementById('url');
    b.addEventListener('click', function () {
      i.select();
      var done = function () { var o = b.textContent; b.textContent = ${JSON.stringify(t.copied)}; setTimeout(function(){ b.textContent = o; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(i.value).then(done).catch(function(){ document.execCommand('copy'); done(); });
      } else { document.execCommand('copy'); done(); }
    });
  })();
</script>
</body>
</html>`;
}
