import { describe, expect, it } from 'vitest';
import { recipeImportUrl } from '@/contours/profiles/lib/recipeImportUrl';

describe('recipeImportUrl: страница GitHub и gist в raw', () => {
  it('страница файла (blob) и ссылка raw на github.com: raw.githubusercontent.com того же файла', () => {
    expect(recipeImportUrl('https://github.com/icecompany-tech/iceslab-recipes/blob/main/recipes/native/xray/vless/x.json')).toEqual({
      url: 'https://raw.githubusercontent.com/icecompany-tech/iceslab-recipes/main/recipes/native/xray/vless/x.json',
      rewritten: true,
      fromGistPage: false,
    });
    expect(recipeImportUrl('  https://github.com/o/r/raw/v1.2/a.json?plain=1#L3 ').url).toBe(
      'https://raw.githubusercontent.com/o/r/v1.2/a.json',
    );
  });

  it('страница gist: raw первого файла; якорь файла не восстановить, экран об этом говорит', () => {
    expect(recipeImportUrl('https://gist.github.com/someone/0123abcd')).toEqual({
      url: 'https://gist.githubusercontent.com/someone/0123abcd/raw',
      rewritten: true,
      fromGistPage: true,
    });
    expect(recipeImportUrl('https://gist.github.com/someone/0123abcd#file-xray-my-json').url).toBe(
      'https://gist.githubusercontent.com/someone/0123abcd/raw',
    );
  });

  it('уже raw, чужой адрес, папка репо и не адрес: как вставлено (без пробелов по краям)', () => {
    for (const s of [
      'https://raw.githubusercontent.com/o/r/main/a.json',
      'https://example.com/recipes.json',
      'https://github.com/o/r/tree/main/recipes',
      'https://gist.githubusercontent.com/u/id/raw/abc/file.json',
      'не адрес',
    ]) {
      expect(recipeImportUrl(` ${s} `)).toEqual({ url: s, rewritten: false, fromGistPage: false });
    }
  });
});
