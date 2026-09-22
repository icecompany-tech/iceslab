import { describe, expect, it } from 'vitest';
import {
  dryRunFacts,
  templateActions,
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
