/**
 * Transport Recipes, pre-validated config presets for the ProfileFormModal.
 *
 * Each recipe is a one-click "I want to achieve X" choice that fills in a
 * known-good combination of fields. Lets new admins configure DPI-resistant
 * transports without learning every protocol's quirks.
 *
 * Differentiator vs Remnawave/Marzban: those panels show raw form fields
 * sorted alphabetically; we group by intent ("max stealth" / "CDN-friendly"
 * / "RU-mobile-tuned") and self-validate combos that xray-core silently
 * rejects (REALITY+ws is the canonical example, looks fine in the form,
 * dies on `xray run` with `REALITY only supports RAW, XHTTP and gRPC`).
 *
 * Recipes only touch protocol-specific fields. Common fields (name,
 * description, enabled) are left to the user.
 */

import type { ProtocolName } from './api';
import type {
  Recipe as WireRecipe,
  RecipeRandomize,
  RecipeRandomizeKind,
} from '@iceslab/shared';

export interface Recipe {
  id: string;
  protocol: ProtocolName;
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
    apply: {
      awgPreset: 'tspu',
      awgSubnet: '10.66.66.0/24',
    },
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
      'Shadowsocks 2022 с шифром 2022-blake3-aes-256-gcm. Современная alternative AEAD, лучше по производительности и резистентности к probe-attacks чем legacy chacha20. Поддерживается всеми актуальными SS-клиентами (Outline, Shadowrocket, sing-box).',
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
];

export function recipesForProtocol(protocol: ProtocolName): Recipe[] {
  return RECIPES.filter((r) => r.protocol === protocol);
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
  return { ...w, protocol: w.protocol as ProtocolName, source: 'registry' };
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
