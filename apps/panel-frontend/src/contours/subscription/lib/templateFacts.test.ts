import { describe, expect, it } from 'vitest';
import {
  dryRunFacts,
  dryRunForBody,
  importFacts,
  templateActions,
  templateEditorFacts,
  templatesScreenFacts,
} from '@/contours/subscription/lib/templateFacts';
import type { SubscriptionTemplate } from '@/lib/domain/subscriptionTemplates';

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

describe('templatesScreenFacts', () => {
  it('1. сервер отвечает 404: экран заглушка, а не ошибка и не пустота', () => {
    expect(templatesScreenFacts({ notImplemented: true }).state).toBe('unavailable');
  });

  it('2. ответа ещё нет: тоже не «пусто», иначе врём на каждое открытие', () => {
    expect(templatesScreenFacts({}).state).toBe('unavailable');
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
    rewrittenKeys: 3,
  };

  it('1. ответа нет или он без шаблона: показывать нечего', () => {
    expect(importFacts(null)).toBeNull();
    expect(importFacts(undefined)).toBeNull();
    expect(importFacts({ rewrittenKeys: 3 })).toBeNull();
  });

  it('2. сервер разобрал файл: тело, тип, имя и число переписанных ключей', () => {
    const f = importFacts(ok)!;
    expect(f.type).toBe('mihomo');
    expect(f.name).toBe('ru-split');
    expect(f.rewrittenKeys).toBe(3);
    expect(f.needsType).toBe(false);
  });

  it('3. тип не определён или незнакомый: спрашиваем оператора', () => {
    expect(importFacts({ template: { body: 'x' } })!.needsType).toBe(true);
    expect(importFacts({ template: { type: 'v2rayN' as never, body: 'x' } })!.needsType).toBe(true);
  });

  it('4. числа ключей нет: это ноль, а не «неизвестно»', () => {
    // Сервер не прислал поле, значит переписывать было нечего: строка «ключей
    // переписано: 0» честнее пустого места, из которого ничего не следует.
    expect(importFacts({ template: { type: 'clash', body: 'x' } })!.rewrittenKeys).toBe(0);
    expect(importFacts({ template: { type: 'clash', body: 'x' }, rewrittenKeys: NaN })!.rewrittenKeys).toBe(0);
  });

  it('5. ЧУЖОЙ КЛЮЧ ОСТАЛСЯ В ТЕЛЕ: это видно, а не проходит молча', () => {
    // Проверка за сервером. Такого быть не должно, но если случилось, шаблон
    // уедет в подписку с ключом, которого наш сборщик не понимает.
    const f = importFacts({
      template: { type: 'mihomo', body: 'remnawave:\n  label: x' },
      rewrittenKeys: 0,
    })!;
    expect(f.foreignKeysLeft).toEqual(['remnawave:']);
  });

  it('6. чистое тело: чужих ключей нет', () => {
    expect(importFacts(ok)!.foreignKeysLeft).toEqual([]);
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

describe('dryRunFacts', () => {
  it('1. прогона не было: показывать нечего', () => {
    expect(dryRunFacts(null)).toBeNull();
    expect(dryRunFacts(undefined)).toBeNull();
  });

  it('2. ядро согласно, жалоб нет: сохранять можно без вопросов', () => {
    const f = dryRunFacts({ ok: true, rendered: 'proxies: []', check: { ok: true }, warnings: [] })!;
    expect(f.canSave).toBe(true);
    expect(f.needsConfirm).toBe(false);
    expect(f.check).toEqual({ ok: true, message: null });
  });

  it('3. ядро возражает: сохранять НЕЛЬЗЯ, и на экране его слова', () => {
    const f = dryRunFacts({
      ok: false, rendered: '', check: { ok: false, message: 'yaml: line 12: mapping values not allowed' },
      warnings: [],
    })!;
    expect(f.canSave).toBe(false);
    expect(f.check.message).toBe('yaml: line 12: mapping values not allowed');
  });

  it('4. ядро согласно, но панель жалуется: сохранять можно, СПРОСИВ', () => {
    const f = dryRunFacts({
      ok: true, rendered: 'x', check: { ok: true }, warnings: ['слот proxies остался пуст'],
    })!;
    expect(f.canSave).toBe(true);
    expect(f.needsConfirm).toBe(true);
    expect(f.warnings).toEqual(['слот proxies остался пуст']);
  });

  it('5. ядро возражает И панель жалуется: подтверждать нечего, отказ главнее', () => {
    const f = dryRunFacts({
      ok: false, rendered: '', check: { ok: false, message: 'нет' }, warnings: ['группа без узлов'],
    })!;
    expect(f.canSave).toBe(false);
    expect(f.needsConfirm).toBe(false);
  });

  it('6. полей нет вовсе: отсутствие ответа ядра это НЕ согласие', () => {
    const f = dryRunFacts({ ok: true, rendered: '', check: undefined as never, warnings: undefined as never })!;
    expect(f.check.ok).toBe(false);
    expect(f.canSave).toBe(false);
    expect(f.warnings).toEqual([]);
  });
});
