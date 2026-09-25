import { describe, expect, it } from 'vitest';
import { PREVIEW_KINDS, PROFILE_KINDS } from '@/contours/profiles/lib/profileKinds';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import {
  EMPTY_TELEGRAM_DRAFT,
  webDraftFromRecipe,
  webDraftRecipeValues,
} from '@/contours/profiles/lib/telegramDraft';
import {
  buildExportRecipe,
  RECIPES,
  RECIPE_COMMON_FIELDS,
  recipesForKind,
  recipeTile,
  registryProblems,
  resolveRecipeApply,
  validateXrayConfig,
} from '@/contours/profiles/lib/recipes';
import { isPlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol';
import en from '@/i18n/locales/en';

describe('рецепты у каждой плитки', () => {
  it('у каждой плитки PROFILE_KINDS не меньше одного встроенного рецепта', () => {
    const bare = PROFILE_KINDS.filter((k) => recipesForKind(k.key).length === 0).map((k) => k.key);
    expect(bare).toEqual([]);
  });

  it('рецепт плитки sing-box не показывается на плитке своего демона, и наоборот', () => {
    expect(recipesForKind('hysteria').every((r) => r.engine === undefined)).toBe(true);
    expect(recipesForKind('hysteria#singbox').every((r) => r.engine === 'singbox')).toBe(true);
    expect(recipesForKind('socks5').map((r) => r.id)).toEqual(['telegram-socks5']);
  });
});

describe('recipeTile: плитка выводится из engine, protocol, subprotocol', () => {
  it('на всех 16 плитках: рецепт с полями плитки ложится ровно на неё, как профиль (profileKindKey)', () => {
    const tiles = [
      ...PROFILE_KINDS.map((k) => ({ key: k.key, r: { protocol: k.protocol, engine: k.engine, subprotocol: k.subprotocol } })),
      ...PREVIEW_KINDS.map((k) => ({ key: k.key, r: { protocol: k.key, engine: 'native' as const } })),
    ];
    expect(tiles).toHaveLength(16);
    for (const { key, r } of tiles) expect(recipeTile(r), key).toBe(key);
  });

  it('sing-box-only протоколы без суффикса; v1 без engine на родной плитке; не-плоский subprotocol не в счёт', () => {
    expect(recipeTile({ protocol: 'tuic', engine: 'singbox' })).toBe('tuic');
    expect(recipeTile({ protocol: 'hysteria' })).toBe('hysteria');
    expect(recipeTile({ protocol: 'xray', subprotocol: 'vless' })).toBe('xray');
    expect(recipeTile({ protocol: 'xray', subprotocol: 'socks' })).toBe('socks5');
  });

  // Тест-миграция (25.09): плитки встроенных рецептов, пока они читались из
  // поля kind. Снимается вместе с массивом RECIPES, когда рецепты придут из
  // снимка реестра.
  it('миграция: каждый встроенный рецепт на той же плитке, что при поле kind', () => {
    const OLD_KIND: Record<string, string> = {
      'xray-reality-vision-raw': 'xray',
      'xray-reality-xhttp': 'xray',
      'xray-trojan-reality': 'xray',
      'xray-reality-grpc-ru': 'xray',
      'hysteria-default': 'hysteria',
      'hysteria-salamander': 'hysteria',
      'awg-default': 'amneziawg',
      'awg-iran': 'amneziawg',
      'naive-default': 'naive',
      'ss-2022-blake3': 'shadowsocks',
      'mtproto-default': 'mtproto',
      'mieru-default': 'mieru',
      'singbox-vless-reality-vision': 'xray#singbox',
      'singbox-hysteria-clean': 'hysteria#singbox',
      'singbox-hysteria-salamander': 'hysteria#singbox',
      'singbox-ss-2022-blake3': 'shadowsocks#singbox',
      'tuic-bbr': 'tuic',
      'anytls-default-padding': 'anytls',
      'shadowtls-v3-bing': 'shadowtls',
      'telegram-socks5': 'socks5',
      'telegram-http': 'http',
      'telegram-web-tproxy-websocket': 'telegramweb',
    };
    expect(RECIPES.map((r) => r.id).sort()).toEqual(Object.keys(OLD_KIND).sort());
    for (const r of RECIPES) expect(recipeTile(r), r.id).toBe(OLD_KIND[r.id]);
  });
});

describe('рецепты у каждой плитки: форма и черновик', () => {

  it('каждый рецепт ложится на пустую форму своей плитки: только её поля, без ошибок', () => {
    for (const kind of PROFILE_KINDS) {
      for (const recipe of recipesForKind(kind.key)) {
        const base = {
          ...defaults(null),
          protocol: kind.protocol,
          engine: kind.engine,
          ...(kind.subprotocol ? { xraySubprotocol: kind.subprotocol } : {}),
        };
        const fields = resolveRecipeApply(recipe);
        for (const k of Object.keys(fields)) {
          expect(k in base, `${recipe.id}: ${k}`).toBe(true);
          expect(RECIPE_COMMON_FIELDS.has(k), `${recipe.id}: ${k}`).toBe(false);
        }
        const merged = { ...base, ...fields };
        if (kind.protocol === 'xray' && !isPlainSubprotocol(merged.xraySubprotocol)) {
          const errors = validateXrayConfig(merged).filter((i) => i.level === 'error');
          expect(errors, recipe.id).toEqual([]);
        }
        // SOCKS5 / HTTP keep their subprotocol: a recipe on their tile never
        // turns the proxy into vless.
        if (kind.subprotocol) expect(merged.xraySubprotocol, recipe.id).toBe(kind.subprotocol);
      }
    }
  });

  it('WEB: у плитки предпросмотра свой встроенный рецепт, он ложится в черновик карточки, не в форму', () => {
    // Every tile, the preview one too (owner, 24.09).
    for (const p of PREVIEW_KINDS) expect(recipesForKind(p.key).length, p.key).toBeGreaterThan(0);
    const [web] = recipesForKind('telegramweb');
    expect(web?.id).toBe('telegram-web-tproxy-websocket');
    const typed = { ...EMPTY_TELEGRAM_DRAFT.web, host: 'old.example.com', secret: 'ab'.repeat(16) };
    const draft = webDraftFromRecipe(typed, resolveRecipeApply(web!));
    // Carrier websocket, the hostname emptied on purpose, the key left alone.
    expect(draft).toEqual({ host: '', secret: 'ab'.repeat(16), path: '', carrier: 'websocket' });
    // None of its keys is a profile form field: it cannot reach a save.
    const form = defaults(null);
    for (const k of Object.keys(resolveRecipeApply(web!))) expect(k in form, k).toBe(false);
  });

  it('WEB: экспорт черновика берёт ключи встроенного рецепта, секрет не уходит', () => {
    const web = { host: 'tg.example.com', secret: 'ab'.repeat(16), path: 'relay', carrier: 'https-lanes' as const };
    const r = buildExportRecipe('telegramweb', webDraftRecipeValues(web), {
      id: 'my-web',
      name: 'My WEB',
      description: 'd',
      dpiResistance: 3,
      speed: 3,
    });
    expect(r.protocol).toBe('telegramweb');
    expect(r.apply).toEqual({ webHostname: 'tg.example.com', webBasePath: 'relay', webCarrier: 'https-lanes' });
    // And the export reads back into the same draft, less the secret.
    expect(webDraftFromRecipe(EMPTY_TELEGRAM_DRAFT.web, r.apply as Record<string, unknown>)).toEqual({ ...web, secret: '' });
  });

  it('id не повторяются, и у каждого рецепта новой плитки есть английская подпись', () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cards = (en as unknown as { recipes: { cards: Record<string, { name?: string }> } }).recipes.cards;
    for (const r of RECIPES) expect(typeof cards[r.id]?.name, r.id).toBe('string');
  });
});

describe('registryProblems: строка на источник, который не отдал рецепты', () => {
  it('три причины по строке, ok молчит, незнакомая причина всё равно строка', () => {
    const p = registryProblems({
      sources: [
        { id: 'a', name: 'iceslab-recipes', ok: false, reason: 'not-found', httpStatus: 404 },
        { id: 'b', name: 'mirror', ok: false, reason: 'unreachable' },
        { id: 'c', name: 'gist', ok: false, reason: 'invalid', httpStatus: 200 },
        { id: 'd', name: 'fine', ok: true },
        { id: 'e', name: 'future', ok: false, reason: 'rate-limited' },
      ],
    });
    expect(p).toEqual([
      { id: 'a', name: 'iceslab-recipes', reason: 'not-found', httpStatus: 404 },
      { id: 'b', name: 'mirror', reason: 'unreachable' },
      { id: 'c', name: 'gist', reason: 'invalid', httpStatus: 200 },
      { id: 'e', name: 'future', reason: 'unknown' },
    ]);
  });

  it('старый сервер без sources[]: null, экран держит прежнюю строку', () => {
    expect(registryProblems({ recipes: [], stale: true } as never)).toBeNull();
    expect(registryProblems(undefined)).toBeNull();
  });
});
