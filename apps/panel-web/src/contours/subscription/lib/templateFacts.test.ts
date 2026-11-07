import { describe, expect, it } from 'vitest';
import {
  dryRunFacts,
  dryRunForBody,
  dryRunWarningOf,
  importFacts,
  nodesInNoGroup,
  type DryRunWarning,
  saveAfterRun,
  singleFlight,
  templateActions,
  templateEditGate,
  templateEditorFacts,
  templateSavePatch,
  templatesScreenFacts,
} from '@/contours/subscription/lib/templateFacts';
import type { SubscriptionTemplate } from '@/lib/old/subscriptionTemplates';

/**
 * Экран шаблонов выдачи, фаза 11.
 *
 * Три состояния экрана и три плашки сухого прогона. Каждая пара, которую легко
 * спутать, стоит своего: «сервер не умеет» вместо «пусто» зовёт создавать
 * шаблон там, где его негде сохранить; «пусто» вместо «не умеет» выглядит как
 * потеря данных; жалоба панели вместо отказа ядра запрещает сохранять
 * работающий конфиг.
 */

function tpl(p: Partial<SubscriptionTemplate>): SubscriptionTemplate {
  return {
    id: p.id ?? 'id',
    type: p.type ?? 'mihomo',
    name: p.name ?? 'name',
    body: p.body ?? '',
    isDefault: p.isDefault ?? false,
    updatedAt: p.updatedAt ?? '2026-09-22T00:00:00.000Z',
  };
}

describe('templateEditGate (A-236, из A-233 п.d)', () => {
  const ok = { data: { templates: [] }, isError: false };
  it('при сбое редактор не открывается пустым: сбой; до ответа загрузка', () => {
    expect(templateEditGate(false, { data: undefined, isError: true }, false, false)).toBe('failed');
    expect(templateEditGate(false, { data: undefined, isError: false }, false, false)).toBe('loading');
  });
  it('«удалён» только при пришедшем списке без шаблона; 404 это «ещё не выпущено»; новый сразу', () => {
    expect(templateEditGate(false, ok, false, false)).toBe('gone');
    expect(templateEditGate(false, ok, false, true)).toBe('ready');
    expect(templateEditGate(false, { data: undefined, isError: true }, true, false)).toBe('unavailable');
    expect(templateEditGate(true, { data: undefined, isError: true }, false, false)).toBe('ready');
  });
});

describe('templateSavePatch (A-236)', () => {
  const own = { name: 'Мой', body: 'a: 1', isDefault: false };
  it('новый целиком, имя обрезано', () => {
    expect(templateSavePatch(null, ' Мой ', 'b')).toEqual({ name: 'Мой', body: 'b' });
  });
  it('существующий только изменённое; ничего не изменено: null', () => {
    expect(templateSavePatch(own, 'Мой', 'a: 1')).toBeNull();
    expect(templateSavePatch(own, 'Новый', 'a: 1')).toEqual({ name: 'Новый' });
    expect(templateSavePatch(own, 'Мой', 'a: 2')).toEqual({ body: 'a: 2' });
  });
  it('у Default имя не уходит вовсе', () => {
    expect(templateSavePatch({ ...own, name: 'Default', isDefault: true }, 'Default', 'x')).toEqual({ body: 'x' });
  });
});

describe('templatesScreenFacts', () => {
  it('1. сервер отвечает 404: экран заглушка, а не ошибка и не пустота', () => {
    expect(templatesScreenFacts({ notImplemented: true }).state).toBe('unavailable');
  });

  it('2. ответа ещё нет: загрузка, а не «пусто» и не «ещё не выпущено»', () => {
    expect(templatesScreenFacts({}).state).toBe('loading');
  });

  it('2а. A-236 (из A-233 п.d): сбой не 404 это сбой; 404 остаётся «ещё не выпущено»', () => {
    expect(templatesScreenFacts({ failed: true }).state).toBe('failed');
    expect(templatesScreenFacts({ failed: true, notImplemented: true }).state).toBe('unavailable');
  });

  it('3. сервер ответил пустым списком: это ПУСТО, приглашение создать', () => {
    const f = templatesScreenFacts({ templates: [] });
    expect(f.state).toBe('empty');
    expect(f.total).toBe(0);
  });

  it('4. список: группы по типу, пустые типы не показываются', () => {
    const f = templatesScreenFacts({
      templates: [tpl({ id: '1', type: 'singbox' }), tpl({ id: '2', type: 'mihomo' })],
    });
    expect(f.state).toBe('list');
    expect(f.groups.map((g) => g.type)).toEqual(['mihomo', 'singbox']);
    expect(f.total).toBe(2);
  });

  it('5. внутри типа Default первым, остальные по имени', () => {
    const f = templatesScreenFacts({
      templates: [
        tpl({ id: '1', name: 'ru-split' }),
        tpl({ id: '2', name: 'Default', isDefault: true }),
        tpl({ id: '3', name: 'ads-off' }),
      ],
    });
    expect(f.groups[0]!.templates.map((x) => x.name)).toEqual(['Default', 'ads-off', 'ru-split']);
  });

  it('6. порядок типов берётся из контракта, а не из ответа сервера', () => {
    const f = templatesScreenFacts({
      templates: [tpl({ id: '1', type: 'xray-json' }), tpl({ id: '2', type: 'clash' })],
    });
    expect(f.groups.map((g) => g.type)).toEqual(['clash', 'xray-json']);
  });
});

describe('templateActions', () => {
  it('1. Default: не удалить и не переименовать, зато восстановить', () => {
    expect(templateActions({ isDefault: true })).toEqual({
      canRename: false, canDelete: false, canRestore: true, protectedReason: 'default',
    });
  });

  it('2. обычный: переименовать и удалить можно, восстанавливать нечего', () => {
    expect(templateActions({ isDefault: false })).toEqual({
      canRename: true, canDelete: true, canRestore: false, protectedReason: null,
    });
  });
});

describe('templateEditorFacts', () => {
  const base = { isNew: false, isDefault: false, name: 'ru-split', body: 'proxies: []', dirty: true };

  it('1. новый шаблон: тип выбирается, имя своё', () => {
    const f = templateEditorFacts({ ...base, isNew: true });
    expect(f.canPickType).toBe(true);
    expect(f.canRename).toBe(true);
  });

  it('2. существующий: тип уже не меняется, это был бы другой шаблон', () => {
    expect(templateEditorFacts(base).canPickType).toBe(false);
  });

  it('3. Default: имя не редактируется, оно зарезервировано контрактом', () => {
    expect(templateEditorFacts({ ...base, isDefault: true }).canRename).toBe(false);
    // Но тело у Default править можно, и сохранять тоже.
    expect(templateEditorFacts({ ...base, isDefault: true }).canSave).toBe(true);
  });

  it('4. называется ПЕРВОЕ недостающее, а не все претензии сразу', () => {
    expect(templateEditorFacts({ ...base, name: '  ', body: '' }).blocker).toBe('name');
    expect(templateEditorFacts({ ...base, body: '   ' }).blocker).toBe('body');
    expect(templateEditorFacts({ ...base, dirty: false }).blocker).toBe('clean');
  });

  it('5. пустое тело не сохраняется: это пустая подписка всем на этом правиле', () => {
    expect(templateEditorFacts({ ...base, body: '' }).canSave).toBe(false);
  });

  it('6. всё на месте и есть правки: сохранять можно', () => {
    const f = templateEditorFacts(base);
    expect(f.canSave).toBe(true);
    expect(f.blocker).toBeNull();
  });
});

describe('importFacts', () => {
  const ok = {
    template: { id: 'x', type: 'mihomo' as const, name: 'ru-split', body: 'iceslab: {}', isDefault: false, updatedAt: '' },
  };

  it('1. ответа нет или он без шаблона: показывать нечего', () => {
    expect(importFacts(null)).toBeNull();
    expect(importFacts(undefined)).toBeNull();
    expect(importFacts({})).toBeNull();
  });

  it('2. сервер разобрал файл: тело, тип, имя', () => {
    const f = importFacts(ok)!;
    expect(f).toEqual({ body: 'iceslab: {}', type: 'mihomo', name: 'ru-split', needsType: false });
  });

  it('3. тип не определён или незнакомый: спрашиваем оператора', () => {
    expect(importFacts({ template: { body: 'x' } })!.needsType).toBe(true);
    expect(importFacts({ template: { type: 'v2rayN' as never, body: 'x' } })!.needsType).toBe(true);
  });
});

describe('nodesInNoGroup: подсказка про iceslab-migrate по коду жалобы (BACK-2 20f07677)', () => {
  const w = (code: string | null, message = 'x') => ({ code, message }) as DryRunWarning;
  it('NO_GROUP_HOLDS_NODE и NO_SELECTOR_HOLDS_NODE: да', () => {
    expect(nodesInNoGroup([w('NO_GROUP_HOLDS_NODE')])).toBe(true);
    expect(nodesInNoGroup([w('NO_SELECTOR_HOLDS_NODE')])).toBe(true);
  });
  it('NO_NODE_IN_PROXIES, строка старого сервера без кода и пусто: нет (по фразе не узнаём)', () => {
    expect(nodesInNoGroup([w('NO_NODE_IN_PROXIES')])).toBe(false);
    expect(nodesInNoGroup([w(null, 'no proxy group holds a node')])).toBe(false);
    expect(nodesInNoGroup([])).toBe(false);
  });
});

describe('dryRunWarningOf: жалоба прогона, вход первым', () => {
  it('объект нового сервера: код из контракта и фраза', () => {
    expect(dryRunWarningOf({ code: 'NO_GROUP_HOLDS_NODE', message: 'no proxy group holds a node' })).toEqual({
      code: 'NO_GROUP_HOLDS_NODE',
      message: 'no proxy group holds a node',
    });
  });
  it('строка старого сервера: фраза без кода; чужой код: null, жалоба не теряется', () => {
    expect(dryRunWarningOf('слот пуст')).toEqual({ code: null, message: 'слот пуст' });
    expect(dryRunWarningOf({ code: 'SOMETHING_NEW', message: 'm' })).toEqual({ code: null, message: 'm' });
  });
  it('без фразы или не объект: пропускается', () => {
    expect(dryRunWarningOf({ code: 'NO_GROUP_HOLDS_NODE' })).toBeNull();
    expect(dryRunWarningOf(null)).toBeNull();
    expect(dryRunWarningOf(3)).toBeNull();
  });
});

describe('имени чужой панели нет в коде фронта (решение владельца 25.10)', () => {
  const FILES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('ни одного литерала, ни в коде, ни в словарях', () => {
    // The names are spelled through character codes so this file is not its own hit.
    const names = [[114, 101, 109, 110, 97, 119, 97, 118, 101], [109, 97, 114, 122, 98, 97, 110], [51, 120, 45, 117, 105]].map((c) =>
      String.fromCharCode(...c),
    );
    const guilty = Object.entries(FILES)
      .filter(([, code]) => names.some((n) => code.toLowerCase().includes(n)))
      .map(([path]) => path);
    expect(Object.keys(FILES).length).toBeGreaterThan(100);
    expect(guilty).toEqual([]);
  });
});

describe('dryRunForBody', () => {
  const run = { ok: true, rendered: 'x', check: { ok: true }, warnings: [] };

  it('1. прогона не было: показывать нечего', () => {
    expect(dryRunForBody(null, null, 'body')).toBeNull();
    expect(dryRunForBody(run, null, 'body')).toBeNull();
  });

  it('2. тело то же: прогон показывается', () => {
    expect(dryRunForBody(run, 'body', 'body')).toBe(run);
  });

  it('3. тело ПРАВИЛИ: прогон исчезает, а не помечается устаревшим', () => {
    // Зелёная плашка над изменённым конфигом читается как зелёная, сколько её
    // ни помечай. Единственный честный вариант это не показывать её вовсе.
    expect(dryRunForBody(run, 'body', 'body + правка')).toBeNull();
  });

  it('4. вернули тело обратно посимвольно: прогон снова годится', () => {
    expect(dryRunForBody(run, 'proxies: []', 'proxies: []')).toBe(run);
  });
});

describe('saveAfterRun (хвост A-236, замечание AUDT)', () => {
  const refused = { ok: false, rendered: '', check: { ok: null }, warnings: ['no proxy group holds a node'] };
  const good = { ok: null, rendered: 'x', check: { ok: null, message: 'not checked: …' }, warnings: [] };
  const res404 = { response: { status: 404 } };

  it('без ручного прогона тело без слота: PUT не уходит', async () => {
    let puts = 0;
    const r = await saveAfterRun({ shown: null, runDry: async () => refused, save: async () => ++puts, notImplemented: () => false });
    expect(r.kind).toBe('refused');
    expect(puts).toBe(0);
  });

  it('годное тело: уходит', async () => {
    let puts = 0;
    const r = await saveAfterRun({ shown: null, runDry: async () => good, save: async () => ++puts, notImplemented: () => false });
    expect(r).toEqual({ kind: 'saved', result: 1, note: null });
  });

  it('сбой прогона и 404 не закрывают сохранение, а помечают его', async () => {
    let puts = 0;
    const down = await saveAfterRun({
      shown: null,
      runDry: async () => {
        throw new Error('net');
      },
      save: async () => ++puts,
      notImplemented: (e) => e === res404,
    });
    expect(down).toEqual({ kind: 'saved', result: 1, note: 'no-answer' });
    const old = await saveAfterRun({
      shown: null,
      runDry: async () => {
        throw res404;
      },
      save: async () => ++puts,
      notImplemented: (e) => e === res404,
    });
    expect(old).toEqual({ kind: 'saved', result: 2, note: 'not-here' });
  });

  it('двойное нажатие: один прогон и одно сохранение', async () => {
    let runs = 0;
    let puts = 0;
    const once = singleFlight();
    const press = () =>
      once(() => saveAfterRun({ shown: null, runDry: async () => (++runs, good), save: async () => ++puts, notImplemented: () => false }));
    const [a, b] = await Promise.all([press(), press()]);
    expect(runs).toBe(1);
    expect(puts).toBe(1);
    expect([a?.kind, b]).toEqual(['saved', undefined]);
    await press();
    expect(puts).toBe(2);
  });

  it('прогон для этого тела уже на экране: второй не зовётся', async () => {
    let runs = 0;
    const r = await saveAfterRun({ shown: good, runDry: async () => (++runs, good), save: async () => 'ok', notImplemented: () => false });
    expect(runs).toBe(0);
    expect(r.kind).toBe('saved');
  });
});

describe('dryRunFacts', () => {
  it('1. прогона не было: показывать нечего', () => {
    expect(dryRunFacts(null)).toBeNull();
    expect(dryRunFacts(undefined)).toBeNull();
  });

  it('2. ok true: «проверено ядром», сохранять можно', () => {
    const f = dryRunFacts({ ok: true, rendered: 'proxies: []', check: { ok: true }, warnings: [] })!;
    expect(f.verdict).toBe('checked');
    expect(f.canSave).toBe(true);
    expect(f.check).toEqual({ ok: true, message: null });
  });

  it('3. ok false от ядра: сохранять НЕЛЬЗЯ, и на экране его слова', () => {
    const f = dryRunFacts({
      ok: false, rendered: '', check: { ok: false, message: 'yaml: line 12: mapping values not allowed' },
      warnings: [],
    })!;
    expect(f.verdict).toBe('refused');
    expect(f.canSave).toBe(false);
    expect(f.check.message).toBe('yaml: line 12: mapping values not allowed');
  });

  it('4. ok null, «not checked: …»: это не «ок», а «ядро не проверяло»; сохранять можно', () => {
    const f = dryRunFacts({
      ok: null, rendered: 'x', check: { ok: null, message: 'not checked: the panel carries no mihomo core' }, warnings: [],
    })!;
    expect(f.verdict).toBe('unchecked');
    expect(f.canSave).toBe(true);
    expect(f.check).toEqual({ ok: null, message: 'not checked: the panel carries no mihomo core' });
  });

  it('5. жалобы панели не теряются и закрывают сохранение (план 4.6), даже при согласии ядра', () => {
    const f = dryRunFacts({
      ok: false, rendered: 'x', check: { ok: true }, warnings: ['ни один узел не дошёл до групп'],
    })!;
    expect(f.verdict).toBe('refused');
    expect(f.canSave).toBe(false);
    expect(f.warnings).toEqual([{ code: null, message: 'ни один узел не дошёл до групп' }]);
  });

  it('5а. ответ нового сервера объектами рисуется фразами и несёт код (20f07677)', () => {
    const f = dryRunFacts({
      ok: false,
      rendered: 'x',
      check: { ok: null },
      warnings: [{ code: 'NO_GROUP_HOLDS_NODE', message: 'no proxy group holds a node' }],
    })!;
    expect(f.verdict).toBe('refused');
    expect(f.warnings).toEqual([{ code: 'NO_GROUP_HOLDS_NODE', message: 'no proxy group holds a node' }]);
    expect(nodesInNoGroup(f.warnings)).toBe(true);
  });

  it('6. старый сервер без ok и без check: «не проверило», не «ок» и не отказ', () => {
    const f = dryRunFacts({ ok: undefined as never, rendered: '', check: undefined as never, warnings: undefined as never })!;
    expect(f.check.ok).toBeNull();
    expect(f.verdict).toBe('unchecked');
    expect(f.canSave).toBe(true);
    expect(f.warnings).toEqual([]);
  });

  it('7. общий ok true над отказом ядра зелёным не становится', () => {
    const f = dryRunFacts({ ok: true, rendered: '', check: { ok: false, message: 'нет' }, warnings: [] })!;
    expect(f.verdict).toBe('refused');
  });
});
