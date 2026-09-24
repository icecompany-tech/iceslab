import { describe, expect, it } from 'vitest';
import { geoSetRefusal, isNotImplemented, nodeGeoFacts, type NodeGeoIntended } from '@/lib/domain/geoSets';

/**
 * Разбор ответов сервера по гео-наборам (geo-contract §5) и строка гео на
 * карточке ноды (§4).
 *
 * Первый тест про `null` не формальность: у react-query `error` это `null`,
 * когда ошибки нет, и функция, читающая у него поле, роняет экран белой
 * страницей. Ровно так упал экран шаблонов 2026-09-22.
 */
const res = (data: unknown, status = 409) => ({ response: { status, data } });

describe('geoSetRefusal: вход проверяется первым', () => {
  it('ошибки нет или мусор: null, а не падение', () => {
    for (const v of [null, undefined, 'строка', 42, {}, { response: null }, res(null)]) {
      expect(geoSetRefusal(v)).toBeNull();
    }
    expect(isNotImplemented(null)).toBe(false);
  });

  it('404: сервер ещё не умеет раздел', () => {
    expect(isNotImplemented({ response: { status: 404 } })).toBe(true);
    expect(isNotImplemented({ response: { status: 500 } })).toBe(false);
  });

  it('GEO_SET_IN_USE называет, кто держит набор, с видом ссылки; кривые записи пропускаются', () => {
    expect(
      geoSetRefusal(
        res({
          error: 'GEO_SET_IN_USE',
          uses: [
            { kind: 'node-policy', id: 'p1', name: 'RU split' },
            { kind: 'node-dns', id: 'n1', name: 'ru-01' },
            { kind: 'route-policy', id: 7 },
          ],
        }),
      ),
    ).toEqual({
      code: 'GEO_SET_IN_USE',
      message: null,
      uses: [
        { kind: 'node-policy', id: 'p1', name: 'RU split' },
        { kind: 'node-dns', id: 'n1', name: 'ru-01' },
      ],
    });
  });

  it('GEO_SET_INVALID несёт reason; GEO_ROLLOUT_STALE текущую версию; BREAKS записи', () => {
    expect(geoSetRefusal(res({ error: 'GEO_SET_INVALID', reason: 'name-reserved' }, 400))).toMatchObject({
      code: 'GEO_SET_INVALID',
      reason: 'name-reserved',
    });
    expect(geoSetRefusal(res({ error: 'GEO_ROLLOUT_STALE', current: 'v3' }))).toMatchObject({ current: 'v3' });
    expect(
      geoSetRefusal(res({ error: 'GEO_ROLLOUT_BREAKS', breaks: [{ entry: 'ext:x:y', uses: [] }, { nope: 1 }] })),
    ).toMatchObject({ breaks: [{ entry: 'ext:x:y', uses: [] }] });
  });

  it('чужой код не выдаётся за свой', () => {
    expect(geoSetRefusal(res({ error: 'PORT_TAKEN_PROFILE' }))).toBeNull();
  });
});

describe('nodeGeoFacts: строка гео на карточке ноды', () => {
  const intended: NodeGeoIntended = {
    version: 'aa11bb22cc33',
    files: [
      { name: 'geosite.dat', sha256: 's1', setId: 'g1', setName: 'geosite', setVersion: '202609240000' },
      { name: 'iceslab-ru.dat', sha256: 's2', setId: 'g2', setName: 'ru', setVersion: 'a1b2' },
    ],
  };
  const at = '2026-09-24T12:00:00.000Z';

  it('сервер поля не отдаёт (нет в fields): строка молчит, даже если ключ случайно есть', () => {
    expect(nodeGeoFacts({}, false)).toBeNull();
    expect(nodeGeoFacts({ geo: null }, false)).toBeNull();
    expect(nodeGeoFacts({}, true)).toBeNull();
  });

  it('geo: null: нода не сообщила', () => {
    expect(nodeGeoFacts({ geo: null, geoIntended: intended }, true)).toEqual({ state: 'unreported' });
  });

  it('все sha совпали: совпадает, с версией намерения', () => {
    expect(
      nodeGeoFacts(
        { geo: { version: 'aa11bb22cc33', files: [{ name: 'geosite.dat', sha256: 's1' }, { name: 'iceslab-ru.dat', sha256: 's2' }], observedAt: at }, geoIntended: intended },
        true,
      ),
    ).toEqual({ state: 'same', version: 'aa11bb22cc33' });
  });

  it('sha другой или файла нет: отстаёт, по именам наборов', () => {
    expect(
      nodeGeoFacts(
        { geo: { version: null, files: [{ name: 'geosite.dat', sha256: 'OLD' }], observedAt: at }, geoIntended: intended },
        true,
      ),
    ).toEqual({ state: 'behind', sets: ['geosite', 'ru'] });
  });

  it('четвёрка: geo null/есть × geoIntended null/есть', () => {
    const geo = { version: 'aa11bb22cc33', files: [{ name: 'geosite.dat', sha256: 's1' }, { name: 'iceslab-ru.dat', sha256: 's2' }], observedAt: at };
    // Намерения нет: молчание (unused), сообщала нода или нет.
    expect(nodeGeoFacts({ geo: null, geoIntended: null }, true)).toEqual({ state: 'unused', version: null });
    expect(nodeGeoFacts({ geo, geoIntended: null }, true)).toEqual({ state: 'unused', version: 'aa11bb22cc33' });
    // Намерение есть: «не сообщила» или сравнение по sha.
    expect(nodeGeoFacts({ geo: null, geoIntended: intended }, true)).toEqual({ state: 'unreported' });
    expect(nodeGeoFacts({ geo, geoIntended: intended }, true)).toEqual({ state: 'same', version: 'aa11bb22cc33' });
  });

  it('пустой список файлов намерения читается как «намерения нет»', () => {
    expect(nodeGeoFacts({ geo: null, geoIntended: { version: 'x', files: [] } }, true)).toMatchObject({ state: 'unused' });
  });
});
