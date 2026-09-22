import { describe, expect, it } from 'vitest';
import { lastAttemptFacts, poolRowFacts } from '@/contours/cascades/lib/cascadeForm';

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
