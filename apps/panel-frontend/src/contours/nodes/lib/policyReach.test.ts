import { describe, expect, it } from 'vitest';
import { policyReachFacts } from '@/contours/nodes/lib/policyReach';
import type { NodeCore } from '@/lib/domain/nodes';

/**
 * Восемь входов, и половина из них про ТРЕТЬЕ состояние.
 *
 * Функция решает, сказать ли оператору «политика тут не работает». Ошибка в
 * сторону «да» стоит одной лишней строки на экране; ошибка в сторону «нет»
 * гасит политику на ноде, где она применяется, и человек идёт искать поломку
 * в ядре. Поэтому проверяется не столько «да» и «нет», сколько граница, за
 * которой отвечать нельзя: неполный ответ не считается фактом.
 *
 * `installed` приехал в контракт вместе с `reservedPorts`, и тесты ниже пережили
 * его появление без правки: отсутствие поля означает «агент старше поля», а не
 * «не установлено», и это ровно то, что проверяет восьмой случай.
 */

/** Ядро как его присылает агент. Тип берётся из контракта, а не выдумывается
 *  здесь: иначе тест переживёт правку, которую обязан заметить. */
function core(p: Partial<NodeCore>): NodeCore {
  return { name: 'xray', ...p } as NodeCore;
}

describe('policyReachFacts', () => {
  it('1. агент ни разу не отчитался: unknown, а не «ядер нет»', () => {
    expect(policyReachFacts(undefined)).toEqual({ state: 'unknown' });
  });

  it('2. отчитался пустым списком: всё равно unknown, оснований судить нет', () => {
    expect(policyReachFacts([])).toEqual({ state: 'unknown' });
  });

  it('3. ядро рисует политику и стоит на машине: applies, с именем и версией', () => {
    expect(
      policyReachFacts([core({ name: 'xray', version: '25.9.5', rendersPolicy: true })]),
    ).toEqual({ state: 'applies', router: { name: 'xray', version: '25.9.5' } });
  });

  it('4. умеет, но бинарника нет: not-applicable, и причина про установку', () => {
    expect(
      policyReachFacts([core({ name: 'xray', rendersPolicy: true, installed: false })]),
    ).toEqual({ state: 'not-applicable', gap: 'router-not-installed' });
  });

  it('5. все ответили, никто не рисует: not-applicable, причина про отсутствие роутера', () => {
    expect(
      policyReachFacts([
        core({ name: 'hysteria', rendersPolicy: false }),
        core({ name: 'amneziawg', rendersPolicy: false }),
      ]),
    ).toEqual({ state: 'not-applicable', gap: 'no-router' });
  });

  it('6. одно сказало «нет», другое молчит: unknown, отказ по неполному списку запрещён', () => {
    expect(
      policyReachFacts([core({ name: 'hysteria', rendersPolicy: false }), core({ name: 'mieru' })]),
    ).toEqual({ state: 'unknown' });
  });

  it('7. одно молчит, но другое рисует и стоит: applies, частичного ответа хватает для «да»', () => {
    const facts = policyReachFacts([
      core({ name: 'mieru' }),
      core({ name: 'xray', version: '25.9.5', rendersPolicy: true }),
    ]);
    expect(facts.state).toBe('applies');
    expect(facts.router?.name).toBe('xray');
  });

  it('8. рисует, а про installed молчит: applies, отсутствие поля это не «не установлено»', () => {
    const facts = policyReachFacts([core({ name: 'xray', rendersPolicy: true })]);
    expect(facts.state).toBe('applies');
    expect(facts.gap).toBeUndefined();
  });
});
