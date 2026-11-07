import { describe, expect, it } from 'vitest';
import { FORMAT_NAMES, TEMPLATE_TYPES, templateTypeForFormat } from '@iceslab/shared';
import { srrTemplateChoices, srrTemplatePatch } from '@/contours/subscription/lib/srrTemplate';
import { srrTemplateRefusal } from '@/lib/old/srr';

const tpl = (type: (typeof TEMPLATE_TYPES)[number], name: string, isDefault = false) => ({ type, name, isDefault });

describe('шаблон правила выдачи (A-236 шаг 4)', () => {
  it('1. поле берёт тип по формату из контракта (A-249): шаблоны того типа, формат без типа без шаблонов', () => {
    const list = TEMPLATE_TYPES.map((t) => tpl(t, `own-${t}`));
    for (const f of FORMAT_NAMES) {
      const type = templateTypeForFormat(f);
      expect(srrTemplateChoices(f, list, null)).toEqual(
        type ? { takesTemplate: true, names: [`own-${type}`] } : { takesTemplate: false, names: [] },
      );
    }
  });

  it('2. выбор: шаблоны своего типа без Default; хранимое имя не пропадает', () => {
    const list = [tpl('mihomo', 'Default', true), tpl('mihomo', 'ru'), tpl('stash', 'st')];
    expect(srrTemplateChoices('mihomo', list, null)).toEqual({ takesTemplate: true, names: ['ru'] });
    expect(srrTemplateChoices('stash', list, 'ru')).toEqual({ takesTemplate: true, names: ['st', 'ru'] });
    expect(srrTemplateChoices('plain', list, 'ru')).toEqual({ takesTemplate: false, names: ['ru'] });
  });

  it('3. сохранение шлёт ключ только при правке; старый сервер ключа не получает', () => {
    expect(srrTemplatePatch(undefined, null, true)).toEqual({});
    expect(srrTemplatePatch(undefined, 'ru', true)).toEqual({ templateName: 'ru' });
    expect(srrTemplatePatch('ru', 'ru', false)).toEqual({});
    expect(srrTemplatePatch('ru', null, false)).toEqual({ templateName: null });
    expect(srrTemplatePatch(null, 'ru', false)).toEqual({ templateName: 'ru' });
    expect(srrTemplatePatch(undefined, 'ru', false)).toEqual({});
  });

  it('4. отказ шаблона читается только со статусом 400 и своим кодом', () => {
    const r = (status: number, data: unknown) => ({ response: { status, data } });
    expect(srrTemplateRefusal(null)).toBeNull();
    expect(srrTemplateRefusal(r(400, { error: 'SRR_TEMPLATE_NOT_FOUND', message: 'no mihomo template named "x"', field: 'templateName' }))).toEqual({
      code: 'SRR_TEMPLATE_NOT_FOUND',
      message: 'no mihomo template named "x"',
    });
    expect(srrTemplateRefusal(r(400, { error: 'SRR_TEMPLATE_NOT_FOR_FORMAT' }))).toEqual({ code: 'SRR_TEMPLATE_NOT_FOR_FORMAT', message: null });
    expect(srrTemplateRefusal(r(409, { error: 'SRR_TEMPLATE_NOT_FOUND' }))).toBeNull();
    expect(srrTemplateRefusal(r(400, { error: 'CONFLICT' }))).toBeNull();
  });
});
