import { describe, expect, it } from 'vitest';
import { PROFILE_KINDS } from '@/contours/profiles/lib/profileKinds';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import {
  RECIPES,
  RECIPE_COMMON_FIELDS,
  recipesForKind,
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
    expect(recipesForKind('hysteria').every((r) => r.kind === undefined)).toBe(true);
    expect(recipesForKind('hysteria#singbox').every((r) => r.kind === 'hysteria#singbox')).toBe(true);
    expect(recipesForKind('socks5').map((r) => r.id)).toEqual(['telegram-socks5']);
  });

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

  it('id не повторяются, и у каждого рецепта новой плитки есть английская подпись', () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cards = (en as unknown as { recipes: { cards: Record<string, { name?: string }> } }).recipes.cards;
    for (const r of RECIPES.filter((x) => x.kind)) expect(typeof cards[r.id]?.name, r.id).toBe('string');
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
