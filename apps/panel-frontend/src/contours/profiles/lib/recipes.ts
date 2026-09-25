/**
 * Transport Recipes, pre-validated config presets for the ProfileFormModal.
 *
 * Each recipe is a one-click "I want to achieve X" choice that fills in a
 * known-good combination of fields. Lets new admins configure DPI-resistant
 * transports without learning every protocol's quirks.
 *
 * Why this exists instead of raw form fields sorted alphabetically: recipes
 * are grouped by intent ("max stealth" / "CDN-friendly" / "RU-mobile-tuned")
 * and self-validate combos that xray-core silently rejects (REALITY+ws is the
 * canonical example, looks fine in the form, dies on `xray run` with
 * `REALITY only supports RAW, XHTTP and gRPC`).
 *
 * Recipes only touch protocol-specific fields. Common fields (name,
 * description, enabled) are left to the user.
 */

import type { ProtocolName } from '@/lib/domain/protocols';
import { profileKindKey, type PreviewKindKey } from '@/contours/profiles/lib/profileKinds';
import { LINK_CONGESTIONS, RECIPE_SCHEMA_VERSION } from '@iceslab/shared';
import type {
  Recipe as WireRecipe,
  RecipeRandomize,
  RecipeRandomizeKind,
  RecipeSourceProblem,
  RecipeSourceStatus,
} from '@iceslab/shared';

/** What a recipe configures: a protocol, or a view the panel draws ahead of
 *  its backend (WEB), whose recipe fills the view's draft and nothing else. */
export type RecipeProtocol = ProtocolName | PreviewKindKey;

export interface Recipe {
  id: string;
  protocol: RecipeProtocol;
  /**
   * Which core runs the recipe (schema v2): the protocol's own (`native`) or
   * sing-box. Absent reads as `native`, which is every v1 recipe. With
   * `protocol` and `subprotocol` it decides the tile (recipeTile), the same
   * way a saved profile finds its tile; the recipe does not name its tile.
   */
  engine?: 'native' | 'singbox';
  /** `socks` or `http` for the two xray subprotocols that have tiles of their
   *  own (Telegram SOCKS5 and HTTP); absent everywhere else. */
  subprotocol?: string;
  /** Single emoji in the chip, pick from a tight palette for visual variety. */
  emoji: string;
  /** Card title, short, direct, intent-driven. */
  name: string;
  /** One-line subtitle explaining when to pick this. */
  description: string;
  /**
   * 1-5 stars: subjective DPI-resistance rating. Vision+REALITY is the
   * gold standard at 5; plain TLS is 2; obfs-augmented protocols at 4-5.
   */
  dpiResistance: 1 | 2 | 3 | 4 | 5;
  /**
   * 1-5 stars: throughput rating. Raw TCP+Vision is fastest at 5; HTTP/2
   * chunked transports lose ~10-20% to framing; UDP-based wins on RTT.
   */
  speed: 1 | 2 | 3 | 4 | 5;
  /** Long-form description shown when card is selected. */
  details: string;
  /**
   * Field overrides applied on click. Keyed loosely, the form merges
   * these into existing values. Only protocol-specific fields belong here.
   *
   * Accepts a plain object OR a thunk that returns one. The thunk form is
   * for recipes with **per-click randomness** (Salamander obfs password,
   * AmneziaWG H1-H4 magic bytes, REALITY+xhttp path): a static object's
   * `Math.random()` evaluates ONCE at module load, so every admin click
   * within a session would get the same value. The consumer resolves the
   * union at click-time so the call site doesn't have to care.
   */
  apply:
    | Record<string, string | number | boolean>
    | (() => Record<string, string | number | boolean>);
  /**
   * Sanity warnings tied to this recipe. Empty array if pristine. Shown
   * as info banners after apply.
   */
  notes?: string[];
  /**
   * Declarative click-time randomisation. Registry recipes use this (they
   * are JSON, no thunk); built-ins use the thunk form of `apply` instead.
   * Resolved values win over the matching `apply` key.
   */
  randomize?: RecipeRandomize[];
  // ───── Registry metadata (absent on built-ins) ─────
  schemaVersion?: number;
  /** Region tag driving the registry filter chips. Absent means GLOBAL. */
  region?: string;
  /** Byline shown on registry cards. */
  author?: string;
  /** Curated/official flag stamped by the registry CI (informational badge). */
  verified?: boolean;
  /** Minimum panel semver; the backend hides recipes newer panels than ours. */
  minPanelVersion?: string;
  /** Source this recipe was merged from (backend-stamped); absent on built-ins. */
  sourceName?: string;
  sourceId?: string;
  /** Provenance. Built-ins leave this undefined (treated as built-in). */
  source?: 'builtin' | 'registry';
}

// Random path generator, REALITY+xhttp benefits from unpredictable paths
// because static "/api/v1/stream" can fingerprint Iceslab deployments.
function randPath(): string {
  const a = Math.random().toString(36).slice(2, 10);
  return `/${a}`;
}

// gRPC serviceName. Random so a static name (e.g. the "grpc-vk" seen in live
// RU configs) doesn't fingerprint every Iceslab RU node identically via the
// subscription URI. The name rides inside the REALITY-encrypted stream and is
// invisible to DPI, so randomising costs no camouflage and removes the tell.
function randServiceName(): string {
  return Math.random().toString(36).slice(2, 10);
}

// AmneziaWG H1-H4 magic-header bytes. Spec requires > 4 + pairwise unique
// + random within int32, a hardcoded 100/200/300/400 fingerprints every
// "Iran-tuned recipe" deploy as Iceslab. Roll fresh on apply.
function randAwgHeader(): number {
  return 5 + Math.floor(Math.random() * (2_147_483_643 - 5));
}
function randAwgHeaders(): {
  awgH1: number;
  awgH2: number;
  awgH3: number;
  awgH4: number;
} {
  const seen = new Set<number>();
  const vals: number[] = [];
  while (vals.length < 4) {
    const n = randAwgHeader();
    if (!seen.has(n)) {
      seen.add(n);
      vals.push(n);
    }
  }
  return {
    awgH1: vals[0]!,
    awgH2: vals[1]!,
    awgH3: vals[2]!,
    awgH4: vals[3]!,
  };
}

export const RECIPES: Recipe[] = [
  // ───── Xray (3) ─────
  {
    id: 'xray-reality-vision-raw',
    protocol: 'xray',
    emoji: '🛡',
    name: 'REALITY + Vision (raw)',
    description: 'Канонический stealth, маскировка под HTTPS-сайт',
    details:
      'VLESS + REALITY + Vision flow поверх raw TCP. Trafic выглядит для DPI как обычный HTTPS-запрос на крупный CDN-сайт (Cloudflare/Apple/etc). Vision flow добавляет zero-copy splice, самый быстрый путь без потери на маскировке. Это рекомендуемый дефолт для большинства ситуаций.',
    dpiResistance: 5,
    speed: 5,
    apply: {
      xraySubprotocol: 'vless',
      xrayFlow: 'xtls-rprx-vision',
      xrayNetwork: 'raw',
      xrayDest: 'www.cloudflare.com:443',
      xrayServerNames: 'www.cloudflare.com',
      xrayFingerprint: 'chrome',
    },
    notes: [
      'Vision работает только с raw, не меняй транспорт после применения recipe',
    ],
  },
  {
    id: 'xray-reality-xhttp',
    protocol: 'xray',
    emoji: '🌐',
    name: 'REALITY + xhttp (HTTP/2 chunked)',
    description: 'Для жёсткого DPI который режет VLESS+raw',
    details:
      'VLESS + REALITY + xhttp transport. Trafic уезжает в HTTP/2 chunked-stream, выглядит как обычный HTTP/2 запрос (выпадает в общую массу h2 трафика к CDN). Чуть медленнее raw (≈10-15% потери на framing), но обходит DPI который начал режать REALITY+raw в некоторых ISP. Без Vision, для xhttp Vision не работает.',
    dpiResistance: 5,
    speed: 4,
    apply: () => ({
      xraySubprotocol: 'vless',
      xrayFlow: '',
      xrayNetwork: 'xhttp',
      xrayDest: 'www.cloudflare.com:443',
      xrayServerNames: 'www.cloudflare.com',
      xrayFingerprint: 'chrome',
      xrayPath: randPath(),
    }),
    notes: [
      'Path рандомизирован, не показывай его публично',
      'Если REALITY+raw блокируется в твоей сети, xhttp обычно ещё работает',
    ],
  },
  {
    id: 'xray-trojan-reality',
    protocol: 'xray',
    emoji: '🐎',
    name: 'Trojan + REALITY',
    description: 'Password-auth вместо UUID, anti-probe defense',
    details:
      'Trojan через xray-core + REALITY. Пользователи аутентифицируются паролем (мы reuse user.xrayUuid как пароль). При неверной аутентификации сервер возвращает реальный HTTPS-ответ с decoy-сайта, anti-probe защита. Без Vision (Trojan его не поддерживает). Полезно для legacy-клиентов которые не умеют VLESS.',
    dpiResistance: 5,
    speed: 4,
    apply: {
      xraySubprotocol: 'trojan',
      xrayFlow: '',
      xrayNetwork: 'raw',
      xrayDest: 'www.cloudflare.com:443',
      xrayServerNames: 'www.cloudflare.com',
      xrayFingerprint: 'chrome',
    },
  },
  {
    id: 'xray-reality-grpc-ru',
    protocol: 'xray',
    emoji: '🇷🇺',
    name: 'REALITY + gRPC (RU-маскировка)',
    description: 'Декой под русский CDN, для РФ где cloudflare-SNI режут',
    details:
      'VLESS + REALITY + gRPC, serverName маскируется под крупный русский CDN (Yandex avatars). РФ-ТСПУ фильтрует по SNI и таргетит cloudflare/зарубежные имена, а русский CDN-домен проходит, плюс огромный объём легитимного трафика для маскировки. Fingerprint firefox ("лояльный" для ТСПУ JA3/JA4; chrome помечается подозрительным). gRPC вместо raw: HTTP/2-фрейминг сложнее зафингерпринтить как прокси. Повторяет рабочие РФ-конфиги 2026. ВНИМАНИЕ: одиночная зарубежная нода под whitelist-shutdown всё равно ляжет, для отключений нужен каскад с RU-входом.',
    dpiResistance: 5,
    speed: 4,
    apply: () => ({
      xraySubprotocol: 'vless',
      xrayFlow: '',
      xrayNetwork: 'grpc',
      xrayServiceName: randServiceName(),
      xrayDest: 'avatars.mds.yandex.net:443',
      xrayServerNames: 'avatars.mds.yandex.net',
      xrayFingerprint: 'firefox',
    }),
    notes: [
      'serverName под русский CDN (avatars.mds.yandex.net); альтернатива ads.x5.ru. Нода должна дотягиваться до dest:443 по TLS 1.3',
      'fingerprint firefox: chrome помечается РФ-ТСПУ как подозрительный',
      'serviceName рандомизирован, чтобы не фингерпринтить Iceslab',
      'Под whitelist-shutdown (отключения) зарубежная нода не спасёт - нужен каскад с RU-входом',
    ],
  },

  // ───── Hysteria (2) ─────
  {
    id: 'hysteria-default',
    protocol: 'hysteria',
    emoji: '⚡',
    name: 'Hysteria 2 (clean)',
    description: 'UDP, низкая latency, без obfs, для свободных регионов',
    details:
      'Hysteria 2 поверх QUIC (UDP) без обфускации. Самая низкая latency (UDP без TCP-handshake) и хорошая throughput через Brutal CC. Без obfs, DPI может обнаружить QUIC-трафик. Подходит для регионов без активного UDP-DPI.',
    dpiResistance: 2,
    speed: 5,
    apply: {
      hyObfsPassword: '',
      hyMasqueradeUrl: '',
      // Явно обнуляем port-hopping чтобы переключение с RU-mobile recipe
      // обратно на clean не оставило 20000-50000 в полях. Recipe должен
      // приводить форму в consistent state, а не делать partial merge.
      hyPortHopStart: '',
      hyPortHopEnd: '',
    },
  },
  {
    id: 'hysteria-salamander',
    protocol: 'hysteria',
    emoji: '🐉',
    name: 'Hysteria 2 + Salamander (RU mobile)',
    description: 'Obfuscation для обхода UDP-DPI на РФ-мобиле',
    details:
      'Hysteria 2 с Salamander obfuscation password. Каждый UDP-пакет XOR-шифруется производным от пароля ключом, DPI не видит QUIC-сигнатуру. На РФ мобильных (Megafon/MTS/Beeline) clean Hysteria часто throttled до tx:0; Salamander обычно проходит. Brutal CC параметры выставлены для пиков 100 Mbps.',
    dpiResistance: 4,
    speed: 5,
    apply: () => ({
      hyObfsPassword: Math.random().toString(36).slice(2, 18),
      hyMasqueradeUrl: 'https://www.bing.com',
      hyBrutalUp: 100,
      hyBrutalDown: 100,
      // Port-hopping (slice 31.5), critical on RU mobile carriers.
      // Без него ТСПУ срезает QUIC-handshake на :443 за секунды.
      // install-iceslab-node.sh по умолчанию выставляет iptables NAT redirect
      // для 20000-50000 → :443, так что client может слать на любой
      // порт из range и сервер всё равно его примет. Здесь admin
      // может сузить range если не хочет такой широкой fanout-зоны.
      hyPortHopStart: 20000,
      hyPortHopEnd: 50000,
    }),
    notes: [
      'Obfs password сгенерирован случайно, не теряй его, нужен на клиентах',
      'Brutal CC 100/100 Mbps, настрой под реальную пропускную способность ноды',
      'Port-hopping 20000-50000 включён, без него RU TSPU режет QUIC. install-iceslab-node.sh уже выставил iptables NAT для этого range',
    ],
  },

  // ───── AmneziaWG (2) ─────
  {
    id: 'awg-default',
    protocol: 'amneziawg',
    emoji: '🔐',
    name: 'AmneziaWG (default)',
    description: 'Дефолтные obfs параметры, для большинства ISP',
    details:
      'AmneziaWG (форк WireGuard с DPI-bypass). Дефолтный preset Jc/Jmin/Jmax + S/H обфускации скрывает WireGuard-сигнатуру. Подходит для большинства провайдеров. На особо жёстких ISP попробуй "Iran-tuned".',
    dpiResistance: 4,
    speed: 5,
    // Set the FULL TSPU field set (not just the preset label) so switching to
    // this recipe after "Iran-tuned" resets the obfuscation numbers instead of
    // leaving Iran values behind, the form must land in a consistent state, not
    // a partial merge. H1-H4 re-rolled per click so the preset does not
    // fingerprint every default deploy identically.
    apply: () => ({
      awgPreset: 'tspu',
      awgJc: 4,
      awgJmin: 64,
      awgJmax: 128,
      awgS1: 32,
      awgS2: 56,
      awgS3: 0,
      awgS4: 0,
      ...randAwgHeaders(),
      awgSubnet: '10.66.66.0/24',
    }),
  },
  {
    id: 'awg-iran',
    protocol: 'amneziawg',
    emoji: '🥷',
    name: 'AmneziaWG (Iran-tuned)',
    description: 'Обфускация под иранский DPI',
    details:
      'AmneziaWG с параметрами обфускации, рекомендованными командой Amnezia для иранских ISP. Jc=4 (junk count), специфические S1-S4 паддинги, H1-H4 хедер-байты. На иранском DPI default-параметры не проходят, эти, да. Также часто помогают на корпоративных firewall.',
    dpiResistance: 5,
    speed: 4,
    apply: () => ({
      // Values within upstream v2.0 bounds (Jmin/Jmax 64..1024, S1-S2 0..64).
      // Iran-tuned variant: more junk packets (Jc=6) + larger Jmax for
      // bigger size variance vs default TSPU.
      // S3+S4 forced to 0, AmneziaVPN client 4.8.15.x drops traffic
      // with non-zero S3/S4 (upstream bug #2582). Reverted to non-zero
      // when upstream fixes the client.
      awgPreset: 'custom',
      awgJc: 6,
      awgJmin: 64,
      awgJmax: 256,
      awgS1: 48,
      awgS2: 64,
      awgS3: 0,
      awgS4: 0,
      ...randAwgHeaders(),
      awgSubnet: '10.66.66.0/24',
    }),
  },

  // ───── Naive (1) ─────
  {
    id: 'naive-default',
    protocol: 'naive',
    emoji: '📡',
    name: 'NaiveProxy (Caddy)',
    description: 'HTTP/2 proxy с Chrome-fingerprint, защищён от probe',
    details:
      'NaiveProxy через Caddy fork. Trafic идёт в HTTP/2 как обычный HTTPS-запрос с правильным Chrome JA3 fingerprint. ACME cert от Let\'s Encrypt автоматически. Один из самых stealth-вариантов для регионов где xray и hysteria уже забанены.',
    dpiResistance: 4,
    speed: 4,
    apply: {
      naiveMasquerade: '/var/www/html',
    },
    notes: [
      'Hostname и tlsEmail заполни вручную, нужен реальный домен с A-записью на ноду',
    ],
  },

  // ───── Shadowsocks (1) ─────
  {
    id: 'ss-2022-blake3',
    protocol: 'shadowsocks',
    emoji: '🔒',
    name: 'SS-2022 (blake3-aes-256)',
    description: 'Современный Shadowsocks, XChaCha20 уровень security',
    details:
      'Shadowsocks 2022 с шифром 2022-blake3-aes-256-gcm. Современная alternative AEAD, лучше по производительности и резистентности к probe-attacks чем legacy chacha20. Поддерживается актуальными клиентами (Shadowrocket, sing-box, Clash Meta); Outline шифры 2022 не понимает.',
    dpiResistance: 3,
    speed: 5,
    apply: {
      ssMethod: '2022-blake3-aes-256-gcm',
    },
  },

  // ───── MTProto (1) ─────
  {
    id: 'mtproto-default',
    protocol: 'mtproto',
    emoji: '📞',
    name: 'MTProto (Telegram)',
    description: 'Только для Telegram-клиента, отдельный use case',
    details:
      'MTProto-прокси для Telegram. Это НЕ general-purpose VPN, только Telegram-трафик. Один shared secret на все юзеры (upstream 9seconds/mtg ограничение). Полезно когда Telegram забанен но хочется быстрого канала именно для месседжера.',
    dpiResistance: 4,
    speed: 5,
    apply: {
      mtgDomain: 'www.cloudflare.com',
    },
  },

  // ───── Mieru (1) ─────
  {
    id: 'mieru-default',
    protocol: 'mieru',
    emoji: '🌸',
    name: 'Mieru (Chinese GFW)',
    description: 'Специально под Great Firewall, random padding',
    details:
      'Mieru от enfein, современный stealth-протокол с агрессивным паддингом, разработан против Chinese GFW. Trafic выглядит как noise, нет сигнатур. Поддерживается sing-box. Используй когда другие протоколы режутся в CN-mainland.',
    dpiResistance: 5,
    speed: 3,
    apply: {
      mieruMtu: 1400,
    },
  },

  // ───── sing-box tiles ─────
  //
  // Only fields the form already has, and only values the agent's sing-box
  // renderer actually writes (apps/node/internal/core/singbox/config.go), each
  // checked against the sing-box inbound docs linked beside it.

  // Xray protocols on sing-box. The agent renders the xray family on sing-box
  // with REALITY only (config.go renderXrayFamilyConfig: tls.reality), so a
  // plain-TLS recipe here would describe a config nobody builds.
  // https://sing-box.sagernet.org/configuration/inbound/vless/ (flow:
  // xtls-rprx-vision), https://sing-box.sagernet.org/configuration/shared/tls/
  {
    id: 'singbox-vless-reality-vision',
    engine: 'singbox',
    protocol: 'xray',
    emoji: '🛡',
    name: 'VLESS + REALITY + Vision (sing-box)',
    description: 'Без тонкой настройки REALITY против проб',
    details:
      'VLESS + REALITY + Vision поверх raw на движке sing-box. Та же ссылка vless://, что у ядра xray, но без тонкой настройки REALITY против проб (ограничение fallback, xver): у sing-box этих полей нет.',
    dpiResistance: 4,
    speed: 5,
    apply: {
      xraySubprotocol: 'vless',
      xraySecurity: 'reality',
      xrayFlow: 'xtls-rprx-vision',
      xrayNetwork: 'raw',
      xrayDest: 'www.cloudflare.com:443',
      xrayServerNames: 'www.cloudflare.com',
      xrayFingerprint: 'chrome',
    },
    notes: ['Vision работает только с raw, не меняй транспорт после применения рецепта'],
  },

  // Hysteria 2 on sing-box: the same two fields sets as the native daemon,
  // which the agent writes as up_mbps / obfs salamander / masquerade.
  // https://sing-box.sagernet.org/configuration/inbound/hysteria2/
  {
    id: 'singbox-hysteria-clean',
    engine: 'singbox',
    protocol: 'hysteria',
    emoji: '⚡',
    name: 'Hysteria 2 (clean, sing-box)',
    description: 'UDP, низкая latency, без obfs, для свободных регионов',
    details:
      'Hysteria 2 на движке sing-box без обфускации. Тот же протокол и та же ссылка hy2://, что у своего демона, одним процессом меньше.',
    dpiResistance: 2,
    speed: 5,
    apply: {
      hyObfsPassword: '',
      hyMasqueradeUrl: '',
      hyPortHopStart: '',
      hyPortHopEnd: '',
    },
  },
  {
    id: 'singbox-hysteria-salamander',
    engine: 'singbox',
    protocol: 'hysteria',
    emoji: '🐉',
    name: 'Hysteria 2 + Salamander (sing-box)',
    description: 'Obfuscation для обхода UDP-DPI на РФ-мобиле',
    details:
      'Hysteria 2 на движке sing-box с obfs salamander и маскировкой под сайт при неудачной авторизации. Brutal 100/100 Mbps, port-hopping 20000-50000.',
    dpiResistance: 4,
    speed: 5,
    apply: () => ({
      hyObfsPassword: Math.random().toString(36).slice(2, 18),
      hyMasqueradeUrl: 'https://www.bing.com',
      hyBrutalUp: 100,
      hyBrutalDown: 100,
      hyPortHopStart: 20000,
      hyPortHopEnd: 50000,
    }),
    notes: [
      'Obfs password сгенерирован случайно, не теряй его, нужен на клиентах',
      'Brutal CC 100/100 Mbps, настрой под реальную пропускную способность ноды',
    ],
  },

  // SS2022 on sing-box: the method list is sing-box's own.
  // https://sing-box.sagernet.org/configuration/inbound/shadowsocks/
  {
    id: 'singbox-ss-2022-blake3',
    engine: 'singbox',
    protocol: 'shadowsocks',
    emoji: '🔒',
    name: 'SS-2022 (blake3-aes-256, sing-box)',
    description: 'Современный Shadowsocks на движке sing-box',
    details:
      'Shadowsocks 2022 с шифром 2022-blake3-aes-256-gcm на движке sing-box, мультипользовательский. Outline шифры 2022 не понимает.',
    dpiResistance: 3,
    speed: 5,
    apply: { ssMethod: '2022-blake3-aes-256-gcm' },
  },

  // TUIC: congestion_control is one of cubic / new_reno / bbr, cubic by
  // default; bbr holds throughput on lossy mobile links. The agent issues a
  // self-signed cert for the SNI (TLS is required by the inbound).
  // https://sing-box.sagernet.org/configuration/inbound/tuic/
  {
    id: 'tuic-bbr',
    engine: 'singbox',
    protocol: 'tuic',
    emoji: '🚀',
    name: 'TUIC (bbr, self-signed)',
    description: 'QUIC с BBR, для потерь на мобильных сетях',
    details:
      'TUIC v5 на sing-box, congestion control bbr (по умолчанию у sing-box cubic). Сертификат нода выпускает сама под SNI из формы, клиентам нужен allow-insecure.',
    dpiResistance: 3,
    speed: 5,
    apply: { tuicCongestion: LINK_CONGESTIONS.find((c) => c === 'bbr')! },
    notes: ['Сертификат самоподписанный: в клиенте включи allow-insecure'],
  },

  // AnyTLS: an empty padding_scheme means sing-box's default scheme, and the
  // agent leaves it empty (config.go: "padding_scheme is left at the sing-box
  // default"), so the recipe has nothing to set but the SNI.
  // https://sing-box.sagernet.org/configuration/inbound/anytls/
  {
    id: 'anytls-default-padding',
    engine: 'singbox',
    protocol: 'anytls',
    emoji: '🧩',
    name: 'AnyTLS (default padding)',
    description: 'TLS-in-TLS с паддингом sing-box по умолчанию',
    details:
      'AnyTLS на sing-box. Схема паддинга стандартная (sing-box подставляет её при пустом padding_scheme), SNI для самоподписанного сертификата ноды.',
    dpiResistance: 4,
    speed: 4,
    apply: { anytlsServerName: 'www.bing.com' },
    notes: ['Сертификат самоподписанный: в клиенте включи allow-insecure'],
  },

  // ShadowTLS: the agent writes version 3 with strict_mode on (config.go),
  // so the recipe only names the handshake site the TLS layer fronts.
  // https://sing-box.sagernet.org/configuration/inbound/shadowtls/
  {
    id: 'shadowtls-v3-bing',
    engine: 'singbox',
    protocol: 'shadowtls',
    emoji: '🎭',
    name: 'ShadowTLS v3 → real site',
    description: 'Рукопожатие настоящего сайта, strict mode',
    details:
      'ShadowTLS v3 в strict mode: TLS-рукопожатие проксируется на www.bing.com:443, внутри Shadowsocks 2022. Ссылки нет, выдаётся только в форматах sing-box и Clash (mihomo).',
    dpiResistance: 5,
    speed: 4,
    apply: {
      shadowtlsHandshake: 'www.bing.com',
      shadowtlsSsMethod: '2022-blake3-aes-128-gcm',
    },
  },

  // ───── Telegram tiles (xray subprotocols) ─────
  // Nothing on the wire to pick (the server takes them plain only); the port
  // belongs to the binding, so the number in the name is the one the deploy
  // window offers.
  {
    id: 'telegram-socks5',
    subprotocol: 'socks',
    protocol: 'xray',
    emoji: '✈',
    name: 'Telegram SOCKS5 (1080)',
    description: 'Ссылка tg://socks для всех трёх клиентов Telegram',
    details:
      'SOCKS5 на ядре xray, вход по логину и паролю пользователя. Без обфускации: для сетей, где прокси разрешён, не для обхода DPI. Порт 1080 предлагается при развёртывании на ноду.',
    dpiResistance: 1,
    speed: 5,
    apply: { xraySubprotocol: 'socks' },
    notes: ['Порт задаётся при развёртывании на ноду, по умолчанию 1080'],
  },
  {
    id: 'telegram-http',
    subprotocol: 'http',
    protocol: 'xray',
    emoji: '🖥',
    name: 'Telegram HTTP (3128)',
    description: 'Только Telegram Desktop, адрес вводится руками',
    details:
      'HTTP CONNECT на ядре xray, вход по логину и паролю пользователя. Только Telegram Desktop, ссылки для добавления нет. Без обфускации. Порт 3128 предлагается при развёртывании на ноду.',
    dpiResistance: 1,
    speed: 5,
    apply: { xraySubprotocol: 'http' },
    notes: ['Порт задаётся при развёртывании на ноду, по умолчанию 3128'],
  },

  // ───── Telegram WEB (preview: the panel draws it, cannot save it yet) ─────
  // Fills the WEB card's draft, never the profile form (webDraftFromRecipe).
  // The carrier and the empty hostname follow the reference relay,
  // https://github.com/telegramdesktop/tproxy-server (README, read 2026-09-23):
  // websocket is the carrier that passes a CDN, the hostname is the operator's
  // own domain and has no sensible default.
  {
    id: 'telegram-web-tproxy-websocket',
    protocol: 'telegramweb',
    emoji: '🌐',
    name: 'WEB (tproxy-server, websocket)',
    description: 'Носитель websocket, домен свой',
    details:
      'Ссылка t.me/webproxy для Telegram Web: Caddy на 443, за ним tproxy-server, за ним MTProxy. Носитель websocket проходит через CDN. Домен не подставляется: это ваш домен с A-записью на ноду. Сохранить профиль WEB панель пока не может.',
    dpiResistance: 3,
    speed: 3,
    apply: { webHostname: '', webBasePath: '', webCarrier: 'websocket' },
    notes: ['Впишите свой домен и сгенерируйте ключ: рецепт их не задаёт'],
  },
];

/**
 * What the recipe rail says about the registry sources that failed, one line
 * each, from `sources[]` of the registry answer. A source that fetched fine
 * says nothing. `null` for a server older than `sources[]`: the rail then
 * keeps its one old "registry offline" line when the answer is stale.
 */
export interface RegistryProblem {
  id: string;
  name: string;
  reason: RecipeSourceProblem | 'unknown';
  httpStatus?: number;
}

export function registryProblems(resp: { sources?: unknown } | null | undefined): RegistryProblem[] | null {
  if (!resp || !Array.isArray(resp.sources)) return null;
  const out: RegistryProblem[] = [];
  for (const s of resp.sources as RecipeSourceStatus[]) {
    if (!s || typeof s !== 'object' || s.ok) continue;
    out.push({
      id: s.id,
      name: s.name,
      // A reason this build does not know still gets a line, as «unknown».
      reason: s.reason === 'not-found' || s.reason === 'unreachable' || s.reason === 'invalid' ? s.reason : 'unknown',
      ...(typeof s.httpStatus === 'number' ? { httpStatus: s.httpStatus } : {}),
    });
  }
  return out;
}

/**
 * The tile a recipe lands on, derived, not read: profileKindKey, the very
 * function a saved profile finds its tile by, so a recipe and the profile it
 * makes cannot land apart. sing-box-only protocols (tuic, anytls, shadowtls)
 * key by their own name, a shared protocol on sing-box by `<protocol>#singbox`,
 * the xray subprotocols socks and http by their Telegram tiles. A v1 recipe
 * (no `engine`) lands on its protocol's native tile.
 */
export function recipeTile(r: Pick<Recipe, 'protocol' | 'engine' | 'subprotocol'>): string {
  return profileKindKey(r.protocol, r.engine ?? 'native', r.subprotocol);
}

/**
 * A recipe's words on screen: the panel's translation by id
 * (`recipes.cards.<id>.{name,description,details,notes}`) where the bundle
 * has one, else the recipe's own text. The registry ships English; the
 * Russian of the recipes that used to be built in lives in the panel by id.
 * A recipe nobody translated shows exactly what its author wrote.
 */
export function recipeText(
  recipe: Pick<Recipe, 'id' | 'name' | 'description' | 'details' | 'notes'>,
  has: (key: string) => boolean,
  t: (key: string, opts?: Record<string, unknown>) => unknown,
): { name: string; description: string; details: string; notes: string[] | undefined } {
  const base = `recipes.cards.${recipe.id}`;
  const str = (suffix: string, own: string) => (has(`${base}.${suffix}`) ? String(t(`${base}.${suffix}`)) : own);
  const notes = has(`${base}.notes`) ? t(`${base}.notes`, { returnObjects: true }) : undefined;
  return {
    name: str('name', recipe.name),
    description: str('description', recipe.description),
    details: str('details', recipe.details),
    notes: Array.isArray(notes) ? notes.map(String) : recipe.notes,
  };
}

/** The built-in recipes of one protocol tile (a PROFILE_KINDS key). */
export function recipesForKind(kindKey: string): Recipe[] {
  return RECIPES.filter((r) => recipeTile(r) === kindKey);
}

// ───── Randomise resolvers ─────

// 16-char base36 secret (Salamander obfs password and similar).
function randPassword16(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  ).slice(0, 16);
}

/** Resolve one declarative randomize descriptor to a concrete value. */
function randomValueFor(kind: RecipeRandomizeKind): string | number {
  switch (kind) {
    case 'token8':
      return randServiceName();
    case 'path':
      return randPath();
    case 'password16':
      return randPassword16();
    case 'awgHeader':
      return randAwgHeader();
  }
}

/**
 * Common profile fields a recipe must never overwrite. They live on the flat
 * FormValues (so `k in current` would let them through) but are not protocol
 * config: a recipe only tunes protocol-specific fields. The apply merge
 * excludes these so an untrusted recipe cannot flip a profile's protocol /
 * engine or silently disable / rename it. Mirrors the backend RecipeSchema.
 */
export const RECIPE_COMMON_FIELDS = new Set([
  'protocol',
  'engine',
  'name',
  'description',
  'enabled',
]);

/**
 * Collapse a recipe's overrides to a single field map. Built-ins may carry a
 * thunk (per-click randomness); registry recipes carry a plain object plus a
 * declarative `randomize` list. The consumer (ProfileFormModal) applies this
 * map without caring which form the recipe used.
 */
export function resolveRecipeApply(
  recipe: Recipe,
): Record<string, string | number | boolean> {
  const base =
    typeof recipe.apply === 'function' ? recipe.apply() : { ...recipe.apply };
  for (const r of recipe.randomize ?? []) {
    base[r.field] = randomValueFor(r.kind);
  }
  return base;
}

/**
 * Adapt a registry (wire) recipe to the frontend Recipe shape. The wire type
 * is already assignable except for provenance, which we stamp so the card can
 * badge it as community/official.
 */
export function fromWireRecipe(w: WireRecipe): Recipe {
  return { ...w, protocol: w.protocol as RecipeProtocol, source: 'registry' };
}

// ───── Export (author your own recipe from the current form) ─────

/**
 * Which ProfileForm fields are protocol-specific, derived from what the
 * built-in recipes actually set. Doubles as the export allowlist: exporting
 * the current config as a recipe pulls exactly these keys, never common
 * fields like name/enabled. Thunks are called once for their KEYS only (the
 * values are irrelevant here), so the module-load randomness does not matter.
 */
export const RECIPE_APPLY_KEYS: Record<string, string[]> = (() => {
  const acc: Record<string, Set<string>> = {};
  for (const r of RECIPES) {
    const obj = typeof r.apply === 'function' ? r.apply() : r.apply;
    const set = (acc[r.protocol] ??= new Set<string>());
    for (const k of Object.keys(obj)) set.add(k);
    for (const rz of r.randomize ?? []) set.add(rz.field);
  }
  const out: Record<string, string[]> = {};
  for (const [proto, set] of Object.entries(acc)) out[proto] = [...set];
  return out;
})();

export interface RecipeExportMeta {
  id: string;
  name: string;
  description: string;
  details?: string;
  emoji?: string;
  dpiResistance: number;
  speed: number;
  region?: string;
}

/**
 * Build a shareable recipe from the current form values. Only the protocol's
 * own fields (RECIPE_APPLY_KEYS) are captured, as a static snapshot: any
 * value the operator randomised is frozen to what is in the form now.
 */
export function buildExportRecipe(
  protocol: string,
  values: Record<string, unknown>,
  meta: RecipeExportMeta,
): Recipe {
  const apply: Record<string, string | number | boolean> = {};
  for (const k of RECIPE_APPLY_KEYS[protocol] ?? []) {
    const v = values[k];
    if (typeof v === 'string' && v !== '') apply[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') apply[k] = v;
  }
  const clampRating = (n: number) =>
    (Math.min(5, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4 | 5);
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: meta.id,
    protocol: protocol as RecipeProtocol,
    emoji: meta.emoji || '⭐',
    name: meta.name,
    description: meta.description,
    details: meta.details || meta.description,
    dpiResistance: clampRating(meta.dpiResistance),
    speed: clampRating(meta.speed),
    apply,
    region: meta.region,
  };
}

/** Trigger a browser download of a recipe as pretty JSON. */
export function downloadRecipeJson(recipe: Recipe): void {
  const blob = new Blob([JSON.stringify(recipe, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${recipe.id || 'recipe'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ───── Live validator ─────
//
// Returns warnings/errors for the current form state. Errors block save
// (returned as `level: 'error'`); warnings just inform.

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  field?: string;
  // Locale-agnostic key + interpolation args. The caller resolves to a
  // string via i18n t(). Earlier this carried a pre-rendered RU-only
  // `message`, which leaked Russian into the EN locale. Forms render with
  // t(issue.key, issue.args ?? {}).
  key: string;
  args?: Record<string, string>;
}

export function validateXrayConfig(values: {
  xrayNetwork: string;
  xrayFlow: string;
  xraySubprotocol: string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Hard error: REALITY only works with raw/xhttp/grpc.
  // Form already filters dropdown to these 3, but defensive, paste/import
  // could carry an invalid value.
  if (!['raw', 'xhttp', 'grpc'].includes(values.xrayNetwork)) {
    issues.push({
      level: 'error',
      field: 'xrayNetwork',
      key: 'validation.xray.networkInvalid',
      args: { network: values.xrayNetwork },
    });
  }

  // Hard error: Vision requires raw.
  if (values.xrayFlow === 'xtls-rprx-vision' && values.xrayNetwork !== 'raw') {
    issues.push({
      level: 'error',
      field: 'xrayFlow',
      key: 'validation.xray.visionRequiresRaw',
      args: { network: values.xrayNetwork },
    });
  }

  // Warning: Trojan + Vision, Trojan не поддерживает Vision.
  if (values.xraySubprotocol === 'trojan' && values.xrayFlow !== '') {
    issues.push({
      level: 'warning',
      field: 'xrayFlow',
      key: 'validation.xray.trojanIgnoresFlow',
    });
  }

  // Info: best practice.
  if (values.xrayNetwork === 'raw' && values.xrayFlow === '') {
    issues.push({
      level: 'info',
      key: 'validation.xray.rawWithoutVisionSlow',
    });
  }

  return issues;
}
