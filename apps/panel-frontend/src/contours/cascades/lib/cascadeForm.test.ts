import { describe, expect, it } from 'vitest';
import {
  CHAIN_ENTRY_PROTOCOLS as SHARED_CHAIN_ENTRY_PROTOCOLS,
  DEFAULT_LINK_CONGESTION,
  LINK_CONGESTIONS,
} from '@iceslab/shared';
import type { EngineName } from '@iceslab/shared';
import {
  CHAIN_ENTRY_PROTOCOLS,
  LINK_PROTOCOL_VALUES,
  cellGaps,
  entryBystanders,
  entryChainFacts,
  entryNoteKind,
  toDirectionInputs,
  lastAttemptFacts,
  legCellNotes,
  legFacts,
  legParamFacts,
  legPortNotes,
  poolRowFacts,
  refusedCells,
  refusedEntryChain,
  refusedEntryChange,
  refusedLinkPorts,
  toPositionInputs,
  withEntryConfirm,
} from '@/contours/cascades/lib/cascadeForm';

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

/**
 * Нога направления: ячейка, движки и ноды, которые её не несут.
 *
 * Три случая из задания фазы 5, и разница между ними это разница между
 * незнанием и фактом. Сервер молчит про таблицу ячеек: hy2 остаётся
 * «нереализованной», и красного нет. Сервер таблицу прислал: ячейка рабочая.
 * Сервер прислал таблицу, а нода направления её не несёт: красное, с именем
 * ноды и списком движков, которые она сообщила о себе.
 */

const TABLE: Record<string, EngineName[]> = {
  vless: ['xray'],
  shadowsocks: ['xray'],
  hy2: ['singbox', 'hysteria'],
  tuic: ['singbox'],
};
const enginesOf = (cell: string) => TABLE[cell];

/** Тот же ответ, что даёт `nodeCarriesCell`, но на подставленной таблице. */
const carriesWith =
  (table: Record<string, EngineName[]> | undefined) =>
  (node: { engines?: EngineName[] } | undefined, cell: string): boolean | undefined => {
    const engines = node?.engines;
    if (!engines) return undefined;
    const carriers = table?.[cell];
    if (!carriers) return undefined;
    return carriers.some((e) => engines.includes(e));
  };

describe('legFacts под ногу направления', () => {
  it('1. сервер молчит про таблицу: hy2 и tuic остаются нереализованными', () => {
    expect(legFacts('hy2', 1).state).toBe('unrealised');
    expect(legFacts('tuic', 1).state).toBe('unrealised');
    // И встроенные две при этом работают как работали.
    expect(legFacts('vless', 1).state).toBe('known');
  });

  it('2. таблица пришла: ячейка становится рабочей и несёт свои движки', () => {
    const f = legFacts('hy2', 2, enginesOf);
    expect(f.state).toBe('known');
    expect(f.engines).toEqual(['singbox', 'hysteria']);
    expect(f.pair).toBeNull();
    expect(f.port).toBe(24002);
  });

  it('3. таблица есть, но этой ячейки в ней нет: по-прежнему нереализована', () => {
    expect(legFacts('naive', 0, enginesOf).state).toBe('unrealised');
  });
});

describe('cellGaps', () => {
  const nodes = new Map<string, { name: string; engines?: EngineName[] }>([
    ['n-xray', { name: 'de-01', engines: ['xray'] }],
    ['n-box', { name: 'nl-02', engines: ['singbox'] }],
    ['n-silent', { name: 'ru-03' }],
    ['n-empty', { name: 'se-04', engines: [] }],
  ]);

  it('1. нода не несёт ячейку: попадает в список с именем и своими движками', () => {
    const gaps = cellGaps(['n-xray'], 'hy2', nodes, carriesWith(TABLE));
    expect(gaps).toEqual([{ nodeId: 'n-xray', name: 'de-01', engines: ['xray'] }]);
  });

  it('2. нода несёт ячейку: в список не попадает', () => {
    expect(cellGaps(['n-box'], 'hy2', nodes, carriesWith(TABLE))).toEqual([]);
  });

  it('3. нода МОЛЧИТ о ядрах: это незнание, красной строки нет', () => {
    expect(cellGaps(['n-silent'], 'hy2', nodes, carriesWith(TABLE))).toEqual([]);
  });

  it('4. таблицы нет: молчим про все ноды, даже про отчитавшиеся', () => {
    expect(cellGaps(['n-xray', 'n-box'], 'hy2', nodes, carriesWith(undefined))).toEqual([]);
  });

  it('5. нода отчиталась ПУСТЫМ списком: это факт «ничего не несёт», красное', () => {
    const gaps = cellGaps(['n-empty'], 'hy2', nodes, carriesWith(TABLE));
    expect(gaps).toEqual([{ nodeId: 'n-empty', name: 'se-04', engines: [] }]);
  });

  it('6. ячейка не выбрана или строка пустая: считать нечего', () => {
    expect(cellGaps(['n-xray'], null, nodes, carriesWith(TABLE))).toEqual([]);
    expect(cellGaps([''], 'hy2', nodes, carriesWith(TABLE))).toEqual([]);
    // Нода, которой нет в списке, это пропажа, и о ячейке она ничего не говорит.
    expect(cellGaps(['n-gone'], 'hy2', nodes, carriesWith(TABLE))).toEqual([]);
  });
});

/**
 * Что нога предлагает настроить.
 *
 * Тест сторожит не разметку, а конфиг на ноде: `congestion_control` на
 * hysteria2 sing-box 1.13.14 отвергает при разборе, а `brutal` на tuic не
 * знает вовсе. Селектор, предложивший такое, кладёт ногу, пока панель пишет
 * «сохранено», и на экране это выглядит как исправная настройка.
 */
describe('legParamFacts', () => {
  it('1. hy2: настраивать НЕЧЕГО, и congestion тут не появляется никогда', () => {
    expect(legParamFacts('hy2')).toEqual({ kind: 'minted', options: [], fallback: null });
  });

  it('2. tuic: список и дефолт КОНТРАКТА, а не переписанные здесь', () => {
    // Сверяемся с контрактом, а не с тройкой значений: своя тройка в тесте это
    // пятая копия словаря, и расходиться она будет молча, как расходились
    // четыре предыдущие. Состав списка сторожит бэкенд, спрашивая движок.
    expect(legParamFacts('tuic')).toEqual({
      kind: 'congestion',
      options: [...LINK_CONGESTIONS],
      fallback: DEFAULT_LINK_CONGESTION,
    });
  });

  it('3. brutal движок на tuic не знает, и предлагать его нельзя', () => {
    expect(legParamFacts('tuic').options).not.toContain('brutal');
  });

  it('4. встроенные ячейки и «не выбрано»: настроек нет', () => {
    for (const cell of ['vless', 'shadowsocks', null, undefined, '']) {
      expect(legParamFacts(cell).kind).toBe('none');
    }
  });

  it('5. чужая ячейка не получает настроек по догадке', () => {
    expect(legParamFacts('hysteria2').kind).toBe('none');
  });
});

/**
 * Отказ сервера записать ногу: 409 `CELL_NOT_CARRIED`.
 *
 * Первый тест здесь про `null`, и он не формальность: у react-query `error`
 * это `null`, когда ошибки нет, а разбор, читающий `err.response` без
 * проверки, роняет экран белым. Ровно это случилось 22.09 на шаблонах, и
 * ворота молчали: после каста к `unknown` tsc разрешает читать что угодно.
 */
describe('refusedCells', () => {
  const ok = {
    response: {
      status: 409,
      data: {
        error: 'CELL_NOT_CARRIED',
        conflicts: [
          { nodeName: 'de-01', cell: 'hy2', engines: ['xray'] },
          { nodeName: 'nl-02', cell: 'tuic', engines: [] },
        ],
      },
    },
  };

  it('1. ошибки нет или она не объект: спокойный null, а не падение', () => {
    for (const x of [null, undefined, 'строка', 42]) expect(refusedCells(x)).toBeNull();
  });

  it('2. чужой отказ не выдаётся за свой', () => {
    expect(refusedCells({ response: { status: 409, data: { error: 'PORT_TAKEN_PROFILE' } } })).toBeNull();
    expect(refusedCells({ response: { status: 400, data: { error: 'CELL_NOT_CARRIED' } } })).toBeNull();
    // Код тот, а списка нет: разбирать нечего, и пустой список соврал бы, что
    // конфликтов не нашлось.
    expect(refusedCells({ response: { status: 409, data: { error: 'CELL_NOT_CARRIED' } } })).toBeNull();
  });

  it('3. перечисляются ВСЕ ноги, а не первая', () => {
    expect(refusedCells(ok)).toEqual([
      { nodeName: 'de-01', cell: 'hy2', engines: ['xray'] },
      { nodeName: 'nl-02', cell: 'tuic', engines: [] },
    ]);
  });

  it('4. мусор в списке пропускается, соседи остаются', () => {
    const parsed = refusedCells({
      response: {
        status: 409,
        data: {
          error: 'CELL_NOT_CARRIED',
          conflicts: [null, { cell: 'hy2' }, { nodeName: 'de-01', cell: 'hy2' }],
        },
      },
    });
    // У записи без движков список пустой, а не выдуманный: строка скажет про
    // это своими словами.
    expect(parsed).toEqual([{ nodeName: 'de-01', cell: 'hy2', engines: [] }]);
  });
});

/**
 * Второй отказ той же формы: 409 `LINK_PORT_IN_USE`.
 *
 * Транспорт в ответе появился 22.09 и в строку попадает обязательно:
 * `24001/udp` и `24001/tcp` это разные сокеты, и занятость одного ничего не
 * говорит о другом. Строка без транспорта была бы наполовину неверной.
 */
describe('refusedLinkPorts', () => {
  it('1. не тот отказ или не объект: спокойный null', () => {
    for (const x of [null, undefined, 'строка']) expect(refusedLinkPorts(x)).toBeNull();
    expect(refusedLinkPorts({ response: { status: 409, data: { error: 'CELL_NOT_CARRIED' } } })).toBeNull();
  });

  it('2. конфликты разбираются с транспортом и именем профиля', () => {
    expect(
      refusedLinkPorts({
        response: {
          status: 409,
          data: {
            error: 'LINK_PORT_IN_USE',
            conflicts: [{ nodeName: 'nl-01', port: 24001, transport: 'udp', profileName: 'hy2-main' }],
          },
        },
      }),
    ).toEqual([{ nodeName: 'nl-01', port: 24001, transport: 'udp', profileName: 'hy2-main' }]);
  });

  it('3. профиль без имени это пустая строка, а не выдумка', () => {
    const parsed = refusedLinkPorts({
      response: {
        status: 409,
        data: { error: 'LINK_PORT_IN_USE', conflicts: [{ nodeName: 'ru-01', port: 24000 }, { port: 1 }] },
      },
    });
    expect(parsed).toEqual([{ nodeName: 'ru-01', port: 24000, transport: '', profileName: '' }]);
  });
});

/**
 * Смена входа, снимающая каскад с профилей (фаза 6): 409
 * `ENTRY_CHANGE_DROPS_USERS`, и согласие на неё.
 */
describe('refusedEntryChange', () => {
  it('1. не тот отказ или не объект: спокойный null', () => {
    for (const x of [null, undefined, 'строка']) expect(refusedEntryChange(x)).toBeNull();
    expect(refusedEntryChange({ response: { status: 409, data: { error: 'LINK_PORT_IN_USE' } } })).toBeNull();
    expect(refusedEntryChange({ response: { status: 409, data: { error: 'ENTRY_CHANGE_DROPS_USERS' } } })).toBeNull();
  });

  it('2. перечисляются все профили с нодами, мусор пропускается, from и to от сервера', () => {
    expect(
      refusedEntryChange({
        response: {
          status: 409,
          data: {
            error: 'ENTRY_CHANGE_DROPS_USERS',
            from: 'xray',
            to: 'hysteria',
            conflicts: [
              { nodeName: 'ru-01', profileName: 'vless-reality' },
              { nodeName: 'ru-02' },
              { nodeName: 'ru-02', profileName: 'vless-xhttp' },
            ],
          },
        },
      }),
    ).toEqual({
      from: 'xray',
      to: 'hysteria',
      conflicts: [
        { nodeName: 'ru-01', profileName: 'vless-reality' },
        { nodeName: 'ru-02', profileName: 'vless-xhttp' },
      ],
    });
  });

  it('3. сервер не назвал from и to: null, а не угаданное по форме', () => {
    const r = refusedEntryChange({
      response: { status: 409, data: { error: 'ENTRY_CHANGE_DROPS_USERS', conflicts: [] } },
    });
    expect(r).toEqual({ from: null, to: null, conflicts: [] });
  });
});

/**
 * 409 `ENTRY_CANNOT_CHAIN` (фаза 6): входные ноды не могут поднять цепь.
 * Факт сервера по отчёту ноды, поэтому кнопку заранее им не гасим.
 */
describe('refusedEntryChain', () => {
  it('1. не тот отказ или не объект: спокойный null', () => {
    for (const x of [null, undefined, 'строка']) expect(refusedEntryChain(x)).toBeNull();
    expect(refusedEntryChain({ response: { status: 409, data: { error: 'ENTRY_CHANGE_DROPS_USERS' } } })).toBeNull();
  });

  it('2. ноды с движками; без списка движков пустой список, а не выдумка', () => {
    expect(
      refusedEntryChain({
        response: {
          status: 409,
          data: {
            error: 'ENTRY_CANNOT_CHAIN',
            conflicts: [{ nodeName: 'ru-01', engines: ['xray'] }, { nodeName: 'ru-02' }, { engines: [] }],
          },
        },
      }),
    ).toEqual([
      { nodeName: 'ru-01', engines: ['xray'] },
      { nodeName: 'ru-02', engines: [] },
    ]);
  });

  it('3. этот отказ разбирается РАНЬШЕ вопроса о согласии и с ним не путается', () => {
    const err = { response: { status: 409, data: { error: 'ENTRY_CANNOT_CHAIN', conflicts: [] } } };
    expect(refusedEntryChain(err)).toEqual([]);
    expect(refusedEntryChange(err)).toBeNull();
  });
});

describe('withEntryConfirm', () => {
  const body = { name: 'ru-de', positions: [], directions: [] };

  it('1. без согласия флага нет ВОВСЕ, ключа тоже', () => {
    const out = withEntryConfirm(body, false);
    expect('confirmEntryChange' in out).toBe(false);
    expect(out).toEqual(body);
  });

  it('2. с согласием флаг ровно true', () => {
    expect(withEntryConfirm(body, true)).toEqual({ ...body, confirmEntryChange: true });
  });

  it('3. флаг не прилипает к исходному объекту', () => {
    // Иначе следующее сохранение того же черновика уехало бы с согласием, уже
    // без вопроса.
    withEntryConfirm(body, true);
    expect('confirmEntryChange' in body).toBe(false);
  });
});

describe('legPortNotes', () => {
  const byId = new Map([['n1', { name: 'nl-01' }], ['n2', { name: 'ru-01' }]]);
  const conflicts = [
    { nodeName: 'nl-01', port: 24001, transport: 'udp', profileName: 'hy2-main' },
    { nodeName: 'ru-01', port: 24000, transport: 'tcp', profileName: 'vless' },
  ];

  it('1. к ноге относится тот конфликт, где совпали И нода, И номер', () => {
    expect(legPortNotes(['n1'], 24001, byId, conflicts)).toEqual([conflicts[0]]);
    expect(legPortNotes(['n1'], 24000, byId, conflicts)).toEqual([]);
    expect(legPortNotes(['n2'], 24001, byId, conflicts)).toEqual([]);
  });

  it('2. порт неизвестен (каскад ещё не сохранён): показывать нечего', () => {
    expect(legPortNotes(['n1'], null, byId, conflicts)).toEqual([]);
    expect(legPortNotes(['n1'], undefined, byId, conflicts)).toEqual([]);
  });
});

describe('legCellNotes', () => {
  const byId = new Map([
    ['n1', { name: 'de-01', engines: ['xray'] as EngineName[] }],
    ['n2', { name: 'nl-02', engines: ['singbox'] as EngineName[] }],
  ]);
  const carries = (node: { engines?: EngineName[] } | undefined, cell: string) =>
    cell === 'hy2' ? (node?.engines ?? []).includes('singbox') : undefined;

  it('1. отказа нет: строки те же, что предсказала таблица движков', () => {
    expect(legCellNotes(['n1', 'n2'], 'hy2', byId, carries, [])).toEqual([
      { nodeId: 'n1', name: 'de-01', engines: ['xray'] },
    ]);
  });

  it('2. одна нода, два источника: строка ОДНА', () => {
    const notes = legCellNotes(['n1'], 'hy2', byId, carries, [
      { nodeName: 'de-01', cell: 'hy2', engines: ['xray'] },
    ]);
    expect(notes).toHaveLength(1);
  });

  it('3. сервер назвал ноду, которую предсказание не поймало: строка появляется', () => {
    // `carries` про tuic отвечает undefined, то есть предсказать нечем, и
    // именно в этом случае отказ сервера единственный источник.
    const notes = legCellNotes(['n2'], 'tuic', byId, carries, [
      { nodeName: 'nl-02', cell: 'tuic', engines: ['singbox'] },
    ]);
    expect(notes).toEqual([{ nodeId: 'nl-02', name: 'nl-02', engines: ['singbox'] }]);
  });

  it('4. отказ про ДРУГУЮ ячейку или другую ноду сюда не попадает', () => {
    expect(
      legCellNotes(['n2'], 'tuic', byId, carries, [
        { nodeName: 'nl-02', cell: 'hy2', engines: [] },
        { nodeName: 'se-09', cell: 'tuic', engines: [] },
      ]),
    ).toEqual([]);
  });
});

/**
 * Форма пейлоада позиции.
 *
 * Правило то же, что у направления, и цена та же: у сервера отсутствие ключа
 * значит «не трогай», `null` значит «сбросить». Экран, который настройку не
 * правил, отправив `null`, стёр бы чужой выбор.
 */
describe('toPositionInputs и нога позиции', () => {
  const base = { key: 0, nodeIds: ['n1'], entryProtocol: 'xray' as const, linkProtocol: 'hy2' };
  // Значение берём из контракта, а не пишем словом: любое имя алгоритма,
  // написанное здесь руками, это ещё одна копия словаря, и сторож в
  // `lib/domain/linkCongestion.test.ts` её справедливо ловит.
  const chosen = LINK_CONGESTIONS.find((c) => c !== DEFAULT_LINK_CONGESTION)!;

  it('1. ногу НЕ трогали: ключа linkParams в пейлоаде нет вовсе', () => {
    const [out] = toPositionInputs([{ ...base, linkParams: { congestion: chosen } }]);
    expect('linkParams' in out!).toBe(false);
    expect(out).toEqual({ nodeIds: ['n1'], position: 0, entryProtocol: 'xray', linkProtocol: 'hy2' });
  });

  it('2. ногу правили: настройки уходят', () => {
    const [out] = toPositionInputs([
      { ...base, linkProtocol: 'tuic', linkParams: { congestion: chosen }, linkTouched: true },
    ]);
    expect(out).toMatchObject({ linkParams: { congestion: chosen } });
  });

  it('3. правили и сбросили: уходит null, и это осмысленное «как по умолчанию»', () => {
    const [out] = toPositionInputs([{ ...base, linkParams: null, linkTouched: true }]);
    expect(out).toMatchObject({ linkParams: null });
  });

  it('4. entryProtocol уходит только у первой позиции', () => {
    const outs = toPositionInputs([base, { ...base, key: 1 }]);
    expect('entryProtocol' in outs[0]!).toBe(true);
    expect('entryProtocol' in outs[1]!).toBe(false);
  });
});

describe('toDirectionInputs и нога', () => {
  const base = { key: 0, id: 'd1', countryCode: 'DE', nodeIds: ['n1'], tag: 1 };

  it('1. ногу НЕ трогали: полей ноги в пейлоаде нет вовсе', () => {
    const [out] = toDirectionInputs([{ ...base, linkProtocol: 'hy2', linkParams: { congestion: 'bbr' } }]);
    expect(out).toEqual({ id: 'd1', countryCode: 'DE', nodeIds: ['n1'] });
    expect('linkProtocol' in out!).toBe(false);
  });

  it('2. ногу правили: уходят ячейка и параметры, порт НИКОГДА', () => {
    const [out] = toDirectionInputs([
      { ...base, linkProtocol: 'tuic', linkParams: { congestion: 'cubic' }, linkPort: 24001, linkTouched: true },
    ]);
    expect(out).toEqual({
      id: 'd1', countryCode: 'DE', nodeIds: ['n1'],
      linkProtocol: 'tuic', linkParams: { congestion: 'cubic' },
    });
    expect('linkPort' in out!).toBe(false);
  });

  it('3. ячейку сбросили руками: уходит null, и это осмысленное «как у входа»', () => {
    const [out] = toDirectionInputs([{ ...base, linkProtocol: null, linkTouched: true }]);
    expect(out).toMatchObject({ linkProtocol: null, linkParams: null });
  });
});

/**
 * Пускает ли цепь трафик, зашедший этим протоколом.
 *
 * Поймано на кадрах владельца 22.09: селектор протокола входа давал выбрать
 * hysteria2 и amneziawg, рядом стояло «VLESS · ядро xray», и каскад
 * сохранялся. Цепь при этом несёт только то, что зашло через xray: hy2-вход
 * это фаза 6, AWG-вход это фаза 7. Экран обещал то, чего нет.
 *
 * Список умений приходит АРГУМЕНТОМ: сегодня это константа, с фазой 6 поле от
 * сервера, и подмена источника не должна переписывать проверку.
 */
describe('entryChainFacts', () => {
  // Список несомых входов подаётся ЯВНО. До 23.09 тесты 2 и 3 брали его по
  // умолчанию из контракта и тем самым утверждали сегодняшний СОСТАВ: с Ф6.4
  // в контракт приедет `hysteria`, и тест «hysteria не несёт» упал бы на
  // правильном коммите. Состав контракта сторожит тест 6, и только он.
  const TODAY = ['xray'];
  const PHASE6 = ['xray', 'hysteria'];

  it('1. xray: цепь такой трафик несёт, и выход клиент выбирает сам', () => {
    expect(entryChainFacts('xray', TODAY)).toEqual({ protocol: 'xray', carried: true, perUserExit: true });
  });

  it('2. hysteria до фазы 6: не несёт, и это факт, а не запрет выбора', () => {
    expect(entryChainFacts('hysteria', TODAY)).toEqual({
      protocol: 'hysteria', carried: false, perUserExit: false,
    });
  });

  it('3. amneziawg: не несёт и после фазы 6', () => {
    expect(entryChainFacts('amneziawg', PHASE6)).toMatchObject({ carried: false, perUserExit: false });
  });

  it('4. протокол не выбран: сказать нечего', () => {
    expect(entryChainFacts(null)).toBeNull();
    expect(entryChainFacts(undefined)).toBeNull();
    expect(entryChainFacts('   ')).toBeNull();
  });

  it('5. список приходит снаружи: с фазой 6 ответ меняется без правки функции', () => {
    expect(entryChainFacts('hysteria', PHASE6)).toEqual({
      protocol: 'hysteria', carried: true, perUserExit: false,
    });
    // И наоборот: пустой список это «пока ничего», а не «всё подходит».
    expect(entryChainFacts('xray', [])).toMatchObject({ carried: false });
  });

  it('6. список приходит из контракта, а не из копии на фронте', () => {
    // Сверяется с тем же массивом, который читает отказ сервера
    // (ENTRY_NOT_CHAINABLE). Разойтись им теперь негде.
    expect(CHAIN_ENTRY_PROTOCOLS).toEqual([...SHARED_CHAIN_ENTRY_PROTOCOLS]);
  });

  it('7. имена протоколов те же, что на проводе: hysteria, не hysteria2', () => {
    // «hysteria2» это ПОДПИСЬ в селекторе, значение там всегда `hysteria`.
    // Note подставляет значение, поэтому оператор видит имя, которое реально
    // уедет на сервер и вернётся в отказе.
    const f = entryChainFacts('hysteria');
    expect(f?.protocol).toBe('hysteria');
    expect(LINK_PROTOCOL_VALUES).toContain('hysteria');
    expect(LINK_PROTOCOL_VALUES).not.toContain('hysteria2');
  });
});

/**
 * Строка под селектором входа.
 *
 * Граница фазы 6: вход по hysteria цепь несёт, но выход его клиенты сами не
 * выбирают, только «Авто» или правила политики. Это не ошибка оператора, и
 * красной строка быть не должна; но и молчать о ней нельзя, иначе оператор
 * узнает о границе от пользователя, который «не может выбрать страну».
 */
/**
 * Профили входных нод, которые в каскад не входят (модель «один вход на
 * каскад», фаза 6).
 */
describe('entryBystanders', () => {
  const nodes = [
    { id: 'n1', name: 'ru-01', countryCode: 'RU' },
    { id: 'n2', name: 'ru-02', countryCode: null },
  ];
  const profiles = [
    { id: 'p-vless', protocol: 'xray' },
    { id: 'p-hy2', protocol: 'hysteria' },
    { id: 'p-awg', protocol: 'amneziawg' },
  ];
  const bind = (profileId: string, nodeId: string, enabled = true) => ({ profileId, nodeId, enabled });

  it('1. чужих профилей нет: строки нет', () => {
    expect(entryBystanders('xray', nodes, [bind('p-vless', 'n1')], profiles)).toEqual([]);
  });

  it('2. один чужой протокол: одна строка у своей ноды', () => {
    expect(entryBystanders('xray', nodes, [bind('p-vless', 'n1'), bind('p-hy2', 'n1')], profiles)).toEqual([
      { nodeId: 'n1', nodeName: 'ru-01', countryCode: 'RU', protocols: ['hysteria'] },
    ]);
  });

  it('3. два чужих протокола: перечислены оба', () => {
    const out = entryBystanders('xray', nodes, [bind('p-hy2', 'n2'), bind('p-awg', 'n2')], profiles);
    expect(out).toEqual([{ nodeId: 'n2', nodeName: 'ru-02', countryCode: null, protocols: ['amneziawg', 'hysteria'] }]);
  });

  it('4. выключенная привязка в счёт не идёт: пользователей через неё нет', () => {
    expect(entryBystanders('xray', nodes, [bind('p-hy2', 'n1', false)], profiles)).toEqual([]);
  });

  it('5. данные не пришли или вход не выбран: сказать нечего, а не «чужих нет»', () => {
    expect(entryBystanders('xray', nodes, undefined, profiles)).toBeUndefined();
    expect(entryBystanders('xray', nodes, [], undefined)).toBeUndefined();
    expect(entryBystanders(null, nodes, [], profiles)).toBeUndefined();
  });

  it('6. профиль, которого нет в списке, чужим не называется', () => {
    expect(entryBystanders('xray', nodes, [bind('p-gone', 'n1')], profiles)).toEqual([]);
  });
});

describe('entryNoteKind', () => {
  const PHASE6 = ['xray', 'hysteria'];

  it('1. hysteria после фазы 6: строка про «Авто» есть', () => {
    expect(entryNoteKind(entryChainFacts('hysteria', PHASE6))).toBe('autoOnly');
  });

  it('2. xray: строки нет, выход клиент выбирает сам', () => {
    expect(entryNoteKind(entryChainFacts('xray', PHASE6))).toBeNull();
  });

  it('3. hysteria ДО фазы 6: отказ, а про «Авто» молчание', () => {
    // Обещать выбор через «Авто» у входа, который в цепь не идёт вовсе, значит
    // врать дважды: отказ проверяется первым.
    expect(entryNoteKind(entryChainFacts('hysteria', ['xray']))).toBe('notCarried');
  });

  it('4. amneziawg после фазы 6: всё ещё отказ', () => {
    expect(entryNoteKind(entryChainFacts('amneziawg', PHASE6))).toBe('notCarried');
  });

  it('5. протокол не выбран: сказать нечего', () => {
    expect(entryNoteKind(null)).toBeNull();
  });
});
