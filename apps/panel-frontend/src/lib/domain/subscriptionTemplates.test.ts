import { describe, expect, it } from 'vitest';
import { TEMPLATE_FORMATS } from '@iceslab/shared';
import {
  TEMPLATE_TYPES,
  isNotImplemented,
  templateBodyLanguage,
  templateFormat,
  templateRefusal,
} from '@/lib/domain/subscriptionTemplates';

/**
 * Разбор ответов сервера по шаблонам.
 *
 * ⚠ Первый тест здесь про `null`, и он не формальность: у react-query `error`
 * это `null`, когда ошибки нет, и обе функции ниже читали у него поле. Экран
 * падал белой страницей при первом же открытии, а сборка и линт молчали,
 * потому что `unknown` разрешает читать что угодно после каста.
 */
describe('разбор ошибок шаблонов', () => {
  it('1. ошибки нет: обе функции отвечают спокойно, а не падают', () => {
    expect(isNotImplemented(null)).toBe(false);
    expect(isNotImplemented(undefined)).toBe(false);
    expect(templateRefusal(null)).toBeNull();
    expect(templateRefusal('строка')).toBeNull();
  });

  it('2. 404: сервер ещё не умеет этот раздел', () => {
    expect(isNotImplemented({ response: { status: 404 } })).toBe(true);
    expect(isNotImplemented({ response: { status: 500 } })).toBe(false);
  });

  it('3. отказ с кодом контракта разбирается вместе с позицией строки', () => {
    expect(
      templateRefusal({
        response: { status: 400, data: { error: 'TEMPLATE_INVALID', message: 'bad yaml', line: 12 } },
      }),
    ).toEqual({ code: 'TEMPLATE_INVALID', message: 'bad yaml', line: 12 });
  });

  it('4. чужой код не выдаётся за свой', () => {
    expect(templateRefusal({ response: { status: 409, data: { error: 'PORT_TAKEN_PROFILE' } } })).toBeNull();
  });

  it('5. Default защищён и имя занято это ОТДЕЛЬНЫЕ коды', () => {
    expect(templateRefusal({ response: { data: { error: 'TEMPLATE_DEFAULT_PROTECTED' } } })?.code).toBe(
      'TEMPLATE_DEFAULT_PROTECTED',
    );
    expect(templateRefusal({ response: { data: { error: 'TEMPLATE_NAME_TAKEN' } } })?.code).toBe(
      'TEMPLATE_NAME_TAKEN',
    );
  });
});

describe('тип шаблона', () => {
  it('1. каркас: три типа на YAML, три на JSON', () => {
    expect(templateBodyLanguage('mihomo')).toBe('yaml');
    expect(templateBodyLanguage('stash')).toBe('yaml');
    expect(templateBodyLanguage('clash')).toBe('yaml');
    expect(templateBodyLanguage('singbox')).toBe('json');
    expect(templateBodyLanguage('xray-json')).toBe('json');
    expect(templateBodyLanguage('xray-json-array')).toBe('json');
  });

  it('2. формат подписки берётся из контракта, а не из копии на фронте', () => {
    expect(TEMPLATE_TYPES.map((x) => templateFormat(x))).toEqual(
      TEMPLATE_TYPES.map((x) => TEMPLATE_FORMATS[x]),
    );
  });

  it('3. stash и clash обрамляют тот же формат clash, что и mihomo', () => {
    // Локальная копия говорила stash -> 'stash', и контракт с ней разошёлся:
    // диалектов без xhttp и без vless у /sub пока нет. Копия снята, значение
    // теперь одно, и вот оно.
    expect(templateFormat('mihomo')).toBe('clash');
    expect(templateFormat('stash')).toBe('clash');
    expect(templateFormat('clash')).toBe('clash');
    expect(templateFormat('singbox')).toBe('singbox');
    expect(templateFormat('xray-json-array')).toBe('xrayjson-array');
    expect(templateFormat('xray-json')).toBe('xrayjson');
  });
});
