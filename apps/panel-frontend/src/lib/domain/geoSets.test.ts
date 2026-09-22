import { describe, expect, it } from 'vitest';
import { geoSetRefusal, geoVersionFacts, isNotImplemented } from '@/lib/domain/geoSets';

/**
 * Разбор ответов сервера по гео-наборам.
 *
 * Первый тест про `null` не формальность: у react-query `error` это `null`,
 * когда ошибки нет, и функция, читающая у него поле, роняет экран белой
 * страницей. Ровно так упал экран шаблонов 2026-09-22.
 */
describe('разбор ошибок гео-наборов', () => {
  it('1. ошибки нет: обе функции отвечают спокойно, а не падают', () => {
    expect(isNotImplemented(null)).toBe(false);
    expect(geoSetRefusal(null)).toBeNull();
    expect(geoSetRefusal('строка')).toBeNull();
  });

  it('2. 404: сервер ещё не умеет этот раздел', () => {
    expect(isNotImplemented({ response: { status: 404 } })).toBe(true);
    expect(isNotImplemented({ response: { status: 500 } })).toBe(false);
  });

  it('3. занятый набор называет политики поимённо: без них «нельзя» бесполезно', () => {
    expect(
      geoSetRefusal({
        response: { data: { error: 'GEO_SET_IN_USE', policies: ['RU split', 'Ads off'] } },
      }),
    ).toEqual({ code: 'GEO_SET_IN_USE', message: undefined, policies: ['RU split', 'Ads off'] });
  });

  it('4. отвергнутый файл несёт слова ядра', () => {
    const r = geoSetRefusal({
      response: { data: { error: 'GEO_SET_INVALID', message: 'xray: unexpected EOF at offset 81920' } },
    });
    expect(r?.message).toBe('xray: unexpected EOF at offset 81920');
  });

  it('5. чужой код не выдаётся за свой', () => {
    expect(geoSetRefusal({ response: { data: { error: 'PORT_TAKEN_PROFILE' } } })).toBeNull();
  });
});

describe('geoVersionFacts', () => {
  it('1. поля нет вовсе: карточка МОЛЧИТ, фаза 9 не доехала', () => {
    // «Нет данных» на каждой ноде парка в день, когда поле завели, выглядит
    // как поломка раскладки, хотя не сломано ничего.
    expect(geoVersionFacts({})).toBeNull();
  });

  it('2. поле есть, нода не сообщала: это уже факт про ноду', () => {
    expect(geoVersionFacts({ geoVersion: null })).toEqual({ state: 'unknown' });
    expect(geoVersionFacts({ geoVersion: '   ' })).toEqual({ state: 'unknown' });
  });

  it('3. нода несёт версию: показываем её как есть', () => {
    expect(geoVersionFacts({ geoVersion: '20260922a' })).toEqual({
      state: 'known', version: '20260922a',
    });
  });
});
