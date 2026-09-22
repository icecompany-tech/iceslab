import { describe, expect, it } from 'vitest';
import { chainFacts } from '@/lib/domain/chainStatus';

/**
 * Четыре состояния процесса цепи.
 *
 * Тест сторожит главное: молчание ноды это НЕ поломка. До фазы 4 блок цепи не
 * посылали никому, и правило «нет статуса значит красное» покрасило бы весь
 * парк в день, когда поле завели.
 */

const SENT = '2026-09-22T05:00:00.000Z';

describe('chainFacts', () => {
  it('1. блок не посылали: рисовать нечего, даже если нода что-то сказала', () => {
    expect(chainFacts({ chainSentAt: null, chainStatus: null })).toBeNull();
    // Нода отчиталась о чужой цепи: панель за неё не отвечает и молчит.
    expect(chainFacts({ chainSentAt: null, chainStatus: { running: true, version: '1.13.14' } })).toBeNull();
    expect(chainFacts(null)).toBeNull();
    expect(chainFacts({})).toBeNull();
  });

  it('2. послали, нода молчит: «нет данных», а не отказ', () => {
    expect(chainFacts({ chainSentAt: SENT, chainStatus: null })).toEqual({ state: 'unknown', sentAt: SENT });
    // Поля нет вовсе: агент старше него, и это ровно то же самое молчание.
    expect(chainFacts({ chainSentAt: SENT })).toEqual({ state: 'unknown', sentAt: SENT });
  });

  it('3. нода сказала «не работает»: красное, словами ядра', () => {
    expect(
      chainFacts({ chainSentAt: SENT, chainStatus: { running: false, error: 'dial tcp 10.0.0.2:443: refused' } }),
    ).toEqual({ state: 'down', sentAt: SENT, error: 'dial tcp 10.0.0.2:443: refused' });
  });

  it('4. «не работает» без причины: состояние остаётся фактом, текст не выдумываем', () => {
    expect(chainFacts({ chainSentAt: SENT, chainStatus: { running: false } })).toEqual({
      state: 'down', sentAt: SENT, error: null,
    });
    expect(chainFacts({ chainSentAt: SENT, chainStatus: { running: false, error: '   ' } })).toEqual({
      state: 'down', sentAt: SENT, error: null,
    });
  });

  it('5. работает: версия рядом, пустая версия это её отсутствие', () => {
    expect(chainFacts({ chainSentAt: SENT, chainStatus: { running: true, version: '1.13.14' } })).toEqual({
      state: 'up', sentAt: SENT, version: '1.13.14',
    });
    expect(chainFacts({ chainSentAt: SENT, chainStatus: { running: true, version: '' } })).toEqual({
      state: 'up', sentAt: SENT, version: null,
    });
    expect(chainFacts({ chainSentAt: SENT, chainStatus: { running: true } })).toEqual({
      state: 'up', sentAt: SENT, version: null,
    });
  });

  it('6. работающая цепь не несёт error: зелёное состояние не спорит само с собой', () => {
    const f = chainFacts({ chainSentAt: SENT, chainStatus: { running: true, error: 'старое' } });
    expect(f).toEqual({ state: 'up', sentAt: SENT, version: null });
  });
});
