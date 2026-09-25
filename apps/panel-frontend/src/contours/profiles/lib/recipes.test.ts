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
  SNAPSHOT_RECIPES,
  RECIPE_COMMON_FIELDS,
  RECIPES_REPO_DEFAULT,
  duplicateRecipeIds,
  fromWireRecipe,
  hiddenAfter,
  importSaved,
  isCuratedRecipe,
  recipeNotFound,
  registryRecipePath,
  registrySkips,
  splitHidden,
  recipeRailEmpty,
  recipesOnTile,
  recipeText,
  recipeTile,
  registryRepo,
  registryProblems,
  resolveRecipeApply,
  validateXrayConfig,
} from '@/contours/profiles/lib/recipes';
import { isPlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol';
import en from '@/i18n/locales/en';
import ru from '@/i18n/locales/ru';

// Снимок реестра, который панель носит с собой (32b5719), как его отдаёт
// сервер (sourceId builtin). Панель своих рецептов в коде не держит.
const onTile = (key: string) => recipesOnTile(SNAPSHOT_RECIPES, key);

describe('рецепты снимка у каждой плитки', () => {
  it('снимок: 22 рецепта, id не повторяются, все помечены как встроенные', () => {
    expect(SNAPSHOT_RECIPES).toHaveLength(22);
    expect(duplicateRecipeIds(SNAPSHOT_RECIPES)).toEqual([]);
    expect(SNAPSHOT_RECIPES.every((r) => r.schemaVersion === 2 && r.source === 'builtin')).toBe(true);
  });

  it('у каждой плитки PROFILE_KINDS не меньше одного рецепта', () => {
    const bare = PROFILE_KINDS.filter((k) => onTile(k.key).length === 0).map((k) => k.key);
    expect(bare).toEqual([]);
  });

  it('рецепт плитки sing-box не показывается на плитке своего демона, и наоборот', () => {
    expect(onTile('hysteria').every((r) => r.engine === 'native')).toBe(true);
    expect(onTile('hysteria#singbox').every((r) => r.engine === 'singbox')).toBe(true);
    expect(onTile('socks5').map((r) => r.id)).toEqual(['telegram-socks5']);
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

});

describe('рецепты у каждой плитки: форма и черновик', () => {

  it('каждый рецепт ложится на пустую форму своей плитки: только её поля, без ошибок', () => {
    for (const kind of PROFILE_KINDS) {
      for (const recipe of onTile(kind.key)) {
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
    for (const p of PREVIEW_KINDS) expect(onTile(p.key).length, p.key).toBeGreaterThan(0);
    const [web] = onTile('telegramweb');
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

  it('randomize: AmneziaWG H1-H4 попарно разные при каждом применении', () => {
    const awg = SNAPSHOT_RECIPES.filter((r) => r.randomize?.some((x) => x.kind === 'awgHeader'));
    expect(awg.length).toBeGreaterThan(0);
    for (const r of awg) {
      for (let i = 0; i < 20; i++) {
        const f = resolveRecipeApply(r);
        const hs = ['awgH1', 'awgH2', 'awgH3', 'awgH4'].map((k) => f[k]);
        expect(new Set(hs).size, r.id).toBe(4);
      }
    }
  });

  it('экспорт в схеме v2: ядро и у xray подпротокол, как у профиля', () => {
    const meta = { id: 'my', name: 'My', description: 'd', dpiResistance: 4, speed: 4 };
    const vless = buildExportRecipe('xray', { engine: 'native', xraySubprotocol: 'vless', xrayNetwork: 'raw' }, meta);
    expect(vless).toMatchObject({ schemaVersion: 2, engine: 'native', protocol: 'xray', subprotocol: 'vless' });
    expect(recipeTile(vless)).toBe('xray');
    const hy = buildExportRecipe('hysteria', { engine: 'singbox' }, meta);
    expect(hy).toMatchObject({ engine: 'singbox', protocol: 'hysteria' });
    expect('subprotocol' in hy).toBe(false);
    expect(recipeTile(hy)).toBe('hysteria#singbox');
  });

  it('registryRecipePath: все 22 рецепта снимка там, где они лежат в реестре', () => {
    // Дерево icecompany-tech/iceslab-recipes на 25.09 (api.github.com git/trees).
    const TREE = [
      'recipes/native/amneziawg/awg-default.json',
      'recipes/native/amneziawg/awg-iran.json',
      'recipes/native/http/telegram-http.json',
      'recipes/native/hysteria/hysteria-default.json',
      'recipes/native/hysteria/hysteria-salamander.json',
      'recipes/native/mieru/mieru-default.json',
      'recipes/native/mtproto/mtproto-default.json',
      'recipes/native/naive/naive-default.json',
      'recipes/native/shadowsocks/ss-2022-blake3.json',
      'recipes/native/socks/telegram-socks5.json',
      'recipes/native/telegramweb/telegram-web-tproxy-websocket.json',
      'recipes/native/xray/trojan/xray-trojan-reality.json',
      'recipes/native/xray/vless/xray-reality-grpc-ru.json',
      'recipes/native/xray/vless/xray-reality-vision-raw.json',
      'recipes/native/xray/vless/xray-reality-xhttp.json',
      'recipes/singbox/anytls/anytls-default-padding.json',
      'recipes/singbox/hysteria/singbox-hysteria-clean.json',
      'recipes/singbox/hysteria/singbox-hysteria-salamander.json',
      'recipes/singbox/shadowsocks/singbox-ss-2022-blake3.json',
      'recipes/singbox/shadowtls/shadowtls-v3-bing.json',
      'recipes/singbox/tuic/tuic-bbr.json',
      'recipes/singbox/xray/vless/singbox-vless-reality-vision.json',
    ];
    expect(SNAPSHOT_RECIPES.map(registryRecipePath).sort()).toEqual([...TREE].sort());
  });

  it('у каждого рецепта снимка есть английская подпись панели', () => {
    const cards = (en as unknown as { recipes: { cards: Record<string, { name?: string }> } }).recipes.cards;
    for (const r of SNAPSHOT_RECIPES) expect(typeof cards[r.id]?.name, r.id).toBe('string');
  });

  it('русская подпись по id у всех 22: имя и столько же заметок, сколько у рецепта снимка', () => {
    const cards = (ru as unknown as { recipes: { cards: Record<string, { name?: string; notes?: string[] }> } }).recipes
      .cards;
    for (const r of SNAPSHOT_RECIPES) {
      expect(typeof cards[r.id]?.name, r.id).toBe('string');
      expect(cards[r.id]?.notes?.length ?? 0, r.id).toBe(r.notes?.length ?? 0);
    }
  });
});

describe('свои и скрытые (контракт 25.09)', () => {
  const r = (id: string) => ({ id });

  it('слияние на сервере: победитель с alsoIn, экран не сливает; два одинаковых id это ошибка', () => {
    const wire = { schemaVersion: 2, id: 'a', protocol: 'xray', alsoIn: ['my-fork'] } as unknown as Parameters<
      typeof fromWireRecipe
    >[0];
    expect(fromWireRecipe(wire).alsoIn).toEqual(['my-fork']);
    expect(duplicateRecipeIds([r('a'), r('b')])).toEqual([]);
    expect(duplicateRecipeIds([r('a'), r('b'), r('a')])).toEqual(['a']);
  });

  it('источник по sourceId: mine свой, builtin снимок, прочее реестр', () => {
    const w = (sourceId?: string) => ({ schemaVersion: 2, id: 'x', protocol: 'xray', sourceId }) as unknown as Parameters<
      typeof fromWireRecipe
    >[0];
    expect(fromWireRecipe(w('mine')).source).toBe('mine');
    expect(fromWireRecipe(w('builtin')).source).toBe('builtin');
    expect(fromWireRecipe(w('src-1')).source).toBe('registry');
    expect(fromWireRecipe(w()).source).toBe('registry');
  });

  it('курируемые (снимок или официальный источник) в рельсе, сообщество и свои ниже', () => {
    expect(isCuratedRecipe({ source: 'builtin' })).toBe(true);
    // Официальный источник выиграл слияние у снимка (так на dev 25.09).
    expect(isCuratedRecipe({ source: 'registry', verified: true })).toBe(true);
    expect(isCuratedRecipe({ source: 'registry', verified: false })).toBe(false);
    expect(isCuratedRecipe({ source: 'registry' })).toBe(false);
    expect(isCuratedRecipe({ source: 'mine', verified: true })).toBe(false);
  });

  it('скрытие и возврат: полная замена списка, скрытые на экране отдельно', () => {
    expect(splitHidden([r('a'), r('b'), r('c')], ['b'])).toEqual({ shown: [r('a'), r('c')], hidden: [r('b')] });
    expect(splitHidden([r('a')], undefined)).toEqual({ shown: [r('a')], hidden: [] });
    expect(hiddenAfter(['b'], 'a', 'hide')).toEqual(['b', 'a']);
    expect(hiddenAfter(['b', 'a'], 'a', 'hide')).toEqual(['b', 'a']);
    expect(hiddenAfter(['b', 'a'], 'b', 'show')).toEqual(['a']);
    expect(hiddenAfter(undefined, 'a', 'show')).toEqual([]);
  });

  it('replaced в обеих ветках; кривой или пустой saved не факт', () => {
    expect(importSaved({ id: 'x', replaced: false })).toEqual({ id: 'x', replaced: false });
    expect(importSaved({ id: 'x', replaced: true })).toEqual({ id: 'x', replaced: true });
    for (const bad of [null, undefined, 'x', {}, { id: 'x' }, { id: 1, replaced: true }]) expect(importSaved(bad)).toBeNull();
  });

  it('registrySkips: пропуски источника словами сервера, кривое не факт', () => {
    const resp = {
      sources: [
        { id: 's1', name: 'my-fork', ok: true, problems: ['recipe old: recipe schemaVersion 1 is not read any more', 7] },
        { id: 's2', name: 'clean', ok: true },
        { id: 's3', name: 'empty', ok: true, problems: [] },
        null,
        { id: 's4', problems: ['x'] },
      ],
    };
    expect(registrySkips(resp)).toEqual([
      { name: 'my-fork', problems: ['recipe old: recipe schemaVersion 1 is not read any more'] },
    ]);
    expect(registrySkips(undefined)).toEqual([]);
    expect(registrySkips({ sources: 'x' })).toEqual([]);
  });

  it('удаление своего: 404 RECIPE_NOT_FOUND это «уже нет», прочее нет', () => {
    const res = (data: unknown, status: number) => ({ response: { status, data } });
    expect(recipeNotFound(res({ error: 'RECIPE_NOT_FOUND' }, 404))).toBe(true);
    for (const e of [null, 'x', res({ error: 'RECIPE_NOT_FOUND' }, 400), res({ error: 'NOT_FOUND' }, 404), res(null, 404)])
      expect(recipeNotFound(e)).toBe(false);
  });
});

describe('панель рецептов: откуда и почему пусто', () => {
  it('registryRepo: owner/repo из source ответа, кривое значение даёт реестр по умолчанию', () => {
    expect(registryRepo('icecompany-tech/iceslab-recipes@4f1c2d0')).toEqual({
      name: 'iceslab-recipes',
      url: 'https://github.com/icecompany-tech/iceslab-recipes',
    });
    expect(registryRepo('me/my-recipes')).toEqual({ name: 'my-recipes', url: 'https://github.com/me/my-recipes' });
    for (const bad of [undefined, 42, '', 'javascript:alert(1)', 'a/b/c'])
      expect(registryRepo(bad).url, String(bad)).toBe(`https://github.com/${RECIPES_REPO_DEFAULT}`);
  });

  it('recipeRailEmpty: у плитки нет рецептов и реестр недоступен без снимка это разные слова', () => {
    const base = { loading: false, failed: false, stale: false, answered: 5, shown: 0 };
    expect(recipeRailEmpty(base)).toBe('tile');
    expect(recipeRailEmpty({ ...base, stale: true, answered: 0 })).toBe('unavailable');
    expect(recipeRailEmpty({ ...base, failed: true })).toBe('unavailable');
    // Устаревший кэш с рецептами это не «недоступен»: показать есть что.
    expect(recipeRailEmpty({ ...base, stale: true, answered: 3 })).toBe('tile');
    expect(recipeRailEmpty({ ...base, shown: 2 })).toBeNull();
    expect(recipeRailEmpty({ ...base, loading: true })).toBeNull();
  });
});

describe('recipeText: перевод по id, иначе текст рецепта', () => {
  const recipe = { id: 'x', name: 'EN name', description: 'EN desc', details: 'EN details', notes: ['EN note'] };
  const bundle: Record<string, unknown> = {
    'recipes.cards.x.name': 'Имя',
    'recipes.cards.x.notes': ['Заметка'],
  };
  const t = (k: string) => bundle[k];
  const has = (k: string) => k in bundle;

  it('есть перевод: берётся он, поле за полем', () => {
    expect(recipeText(recipe, has, t)).toEqual({
      name: 'Имя',
      description: 'EN desc',
      details: 'EN details',
      notes: ['Заметка'],
    });
  });

  it('рецепт без перевода (чужой из реестра): как написал автор', () => {
    expect(recipeText({ ...recipe, id: 'y' }, has, t)).toEqual({
      name: 'EN name',
      description: 'EN desc',
      details: 'EN details',
      notes: ['EN note'],
    });
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
