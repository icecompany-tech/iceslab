import { describe, expect, it } from 'vitest';
import { lastAttemptFacts, legFacts, poolRowFacts } from '@/contours/cascades/lib/cascadeForm';

/**
 * Что стоит в строке пула на месте выбора ноды.
 *
 * Тест сторожит одну подмену, и она дорогая: строка с `nodeId`, которого нет
 * среди нод, рисовалась ПУСТЫМ селектором, то есть выглядела как «оператор не
 * выбрал ноду». Человек шёл выбирать заново вместо того, чтобы понять, что
 * машину под направлением удалили. Поймано на стенде 2026-09-22, направление
 * 0001 держало удалённую ноду.
 */

const nodes = [{ id: 'd0b08fe3-1111-2222-3333-444455556666' }, { id: 'aaaa1111-2222-3333-4444-555566667777' }];

describe('poolRowFacts', () => {
  it('1. пустая строка: оператор ещё не выбрал, и селектор тут прав', () => {
    expect(poolRowFacts('', nodes)).toEqual({ state: 'empty' });
  });

  it('2. нода на месте: обычная строка с выбором', () => {
    const f = poolRowFacts(nodes[0]!.id, nodes);
    expect(f.state).toBe('known');
    expect(f.nodeId).toBe(nodes[0]!.id);
  });

  it('3. ноды нет в списке: это ПРОПАЖА, а не пустой выбор', () => {
    const f = poolRowFacts('d0b08fe3-9999-8888-7777-666655554444', nodes);
    expect(f.state).toBe('missing');
  });

  it('4. пропажа несёт id: единственная зацепка, чтобы найти её в логах', () => {
    const f = poolRowFacts('d0b08fe3-9999-8888-7777-666655554444', nodes);
    expect(f.nodeId).toBe('d0b08fe3-9999-8888-7777-666655554444');
    expect(f.shortId).toBe('d0b08fe3');
  });

  it('5. список нод ещё не пришёл: строка с id это пропажа, а не пустота', () => {
    // Спорный на вид случай, и он верный: пока нод нет, сказать «выбери ноду»
    // про заполненную строку нельзя, это было бы тем же враньём о причине.
    expect(poolRowFacts('d0b08fe3-9999-8888-7777-666655554444', []).state).toBe('missing');
    // Пустая строка при пустом списке остаётся пустой.
    expect(poolRowFacts('', []).state).toBe('empty');
  });

  it('6. известная нода не отдаёт shortId: у неё показывается имя, а не номер', () => {
    expect(poolRowFacts(nodes[1]!.id, nodes).shortId).toBeUndefined();
  });
});

/**
 * Когда каскад в последний раз ПЫТАЛИСЬ разослать.
 *
 * Сторожит ту самую пару, из-за которой карточка врала: время сохранения рядом
 * со словом «ещё не применено». Отвергнутый пуш не двигает `lastInboundSyncAt`,
 * поэтому попытка живёт в `lastInboundSyncError.at`, и брать надо позднейшее из
 * двух, а не первое попавшееся.
 */

type Reported = { lastInboundSyncAt?: string | null; lastInboundSyncError?: { at: string } | null };

function fleet(entries: [string, Reported][]) {
  return new Map<string, Reported>(entries);
}

const hops = [{ nodeId: 'a' }, { nodeId: 'b' }, { nodeId: 'c' }, { nodeId: 'd' }];

describe('lastAttemptFacts', () => {
  it('1. никто не отчитался: строки нет вовсе, пустое время хуже молчания', () => {
    expect(lastAttemptFacts(hops, fleet([]))).toBeNull();
    expect(
      lastAttemptFacts(hops, fleet([['a', { lastInboundSyncAt: null, lastInboundSyncError: null }]])),
    ).toBeNull();
  });

  it('2. все приняли: попытка это позднейший успех, отказов ноль', () => {
    const f = lastAttemptFacts(hops.slice(0, 2), fleet([
      ['a', { lastInboundSyncAt: '2026-09-22T10:00:00.000Z' }],
      ['b', { lastInboundSyncAt: '2026-09-22T10:05:00.000Z' }],
    ]));
    expect(f).toEqual({ at: '2026-09-22T10:05:00.000Z', refused: 0, answered: 2 });
  });

  it('3. отказ ПОЗЖЕ успеха: хоп считается отвергнувшим', () => {
    const f = lastAttemptFacts([{ nodeId: 'a' }], fleet([
      ['a', {
        lastInboundSyncAt: '2026-09-22T10:00:00.000Z',
        lastInboundSyncError: { at: '2026-09-22T10:30:00.000Z' },
      }],
    ]));
    expect(f).toEqual({ at: '2026-09-22T10:30:00.000Z', refused: 1, answered: 1 });
  });

  it('4. успех ПОЗЖЕ отказа: состояние снялось само, красного больше нет', () => {
    const f = lastAttemptFacts([{ nodeId: 'a' }], fleet([
      ['a', {
        lastInboundSyncAt: '2026-09-22T11:00:00.000Z',
        lastInboundSyncError: { at: '2026-09-22T10:30:00.000Z' },
      }],
    ]));
    expect(f).toEqual({ at: '2026-09-22T11:00:00.000Z', refused: 0, answered: 1 });
  });

  it('5. «2 из 4»: знаменатель это отчитавшиеся, а не все хопы', () => {
    const f = lastAttemptFacts(hops, fleet([
      ['a', { lastInboundSyncError: { at: '2026-09-22T09:00:00.000Z' } }],
      ['b', { lastInboundSyncError: { at: '2026-09-22T09:01:00.000Z' } }],
      ['c', { lastInboundSyncAt: '2026-09-22T09:02:00.000Z' }],
      ['d', { lastInboundSyncAt: '2026-09-22T09:03:00.000Z' }],
    ]));
    expect(f).toEqual({ at: '2026-09-22T09:03:00.000Z', refused: 2, answered: 4 });
  });

  it('6. молчащий хоп в знаменатель не идёт: о нём фактов нет', () => {
    const f = lastAttemptFacts(hops, fleet([
      ['a', { lastInboundSyncError: { at: '2026-09-22T09:00:00.000Z' } }],
      ['b', {}],
    ]));
    expect(f).toEqual({ at: '2026-09-22T09:00:00.000Z', refused: 1, answered: 1 });
  });

  it('7. хопов нет: считать нечего', () => {
    expect(lastAttemptFacts([], fleet([['a', { lastInboundSyncAt: '2026-09-22T09:00:00.000Z' }]]))).toBeNull();
  });
});

/**
 * Нога между позициями: ячейка, движок и порт.
 *
 * Сторожит две подмены. Первая: сохранённое имя, которого панель не знает, это
 * НЕ рабочая нога, и пары протокол+движок у него нет, её нельзя выдумать.
 * Вторая: порт назначает панель по номеру шага, и строка обязана показывать
 * именно тот порт, который оператор пойдёт открывать в фаерволе.
 */

describe('legFacts', () => {
  it('1. пусто: ячейка не выбрана, это «неизвестно», а не ошибка', () => {
    expect(legFacts(null, 0)).toEqual({ state: 'unknown', cell: null, pair: null, port: 24000 });
    expect(legFacts('', 1)).toEqual({ state: 'unknown', cell: null, pair: null, port: 24001 });
    expect(legFacts('   ', 2).state).toBe('unknown');
  });

  it('2. хранимый xray это ячейка vless: колонка держит имя движка по истории', () => {
    expect(legFacts('xray', 0)).toEqual({
      state: 'known', cell: 'xray', pair: { protocol: 'vless', engine: 'xray' }, port: 24000,
    });
  });

  it('3. vless записан прямо: та же ячейка, тот же ответ', () => {
    expect(legFacts('vless', 0).pair).toEqual({ protocol: 'vless', engine: 'xray' });
  });

  it('4. shadowsocks: вторая реализованная ячейка, движок тот же xray', () => {
    expect(legFacts('shadowsocks', 1)).toEqual({
      state: 'known', cell: 'shadowsocks', pair: { protocol: 'shadowsocks', engine: 'xray' }, port: 24001,
    });
  });

  it('5. ячейка, которой панель не умеет: показываем что записано, пару НЕ выдумываем', () => {
    // hy2 и tuic станут ногами в фазе 5; до неё сохранённое имя это просто
    // строка, и говорить «ходит по hy2 через sing-box» панель права не имеет.
    for (const cell of ['hysteria', 'tuic', 'mieru']) {
      const f = legFacts(cell, 0);
      expect(f.state).toBe('unrealised');
      expect(f.cell).toBe(cell);
      expect(f.pair).toBeNull();
    }
  });

  it('6. порт это 24000 плюс номер шага, и он же у нереализованной ячейки', () => {
    expect(legFacts('xray', 0).port).toBe(24000);
    expect(legFacts('xray', 3).port).toBe(24003);
    expect(legFacts('tuic', 4).port).toBe(24004);
    expect(legFacts(null, 4).port).toBe(24004);
  });
});
