import { describe, expect, it } from 'vitest';
import { hostHiddenFacts } from '@/lib/domain/hosts';

/**
 * Хост на ноде, которая в каскаде не вход: подписка его не выдаёт никому, пока
 * каскад включён. Три входа, два из них молчат.
 */
describe('hostHiddenFacts', () => {
  it('1. ключа нет (бэкенд старше поля): молчим', () => {
    expect(hostHiddenFacts({}, 'de-01')).toBeNull();
  });

  it('2. null: хост не скрыт, молчим', () => {
    expect(hostHiddenFacts({ hiddenByCascade: null }, 'de-01')).toBeNull();
  });

  it('3. скрыт каскадом: нода, каскад и его id для ссылки', () => {
    expect(
      hostHiddenFacts({ hiddenByCascade: { cascadeId: 'c1', cascadeName: 'ru-de-relay' } }, 'de-01'),
    ).toEqual({ nodeName: 'de-01', cascadeId: 'c1', cascadeName: 'ru-de-relay' });
  });

  it('4. хоста нет вовсе: молчим, а не падаем', () => {
    expect(hostHiddenFacts(null, 'de-01')).toBeNull();
    expect(hostHiddenFacts(undefined, 'de-01')).toBeNull();
  });
});
