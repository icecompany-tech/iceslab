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

  const byNode = { hiddenByCascade: { cascadeId: 'c2', cascadeName: 'node-fact' } };

  it('5. хоста нет, нода скрыта: говорит факт ноды (окно до развёртывания)', () => {
    expect(hostHiddenFacts(undefined, 'de-01', byNode)).toEqual({
      nodeName: 'de-01',
      cascadeId: 'c2',
      cascadeName: 'node-fact',
    });
  });

  it('6. факт хоста главный: и объект, и null у хоста перебивают ноду', () => {
    expect(
      hostHiddenFacts({ hiddenByCascade: { cascadeId: 'c1', cascadeName: 'host-fact' } }, 'de-01', byNode)
        ?.cascadeName,
    ).toBe('host-fact');
    expect(hostHiddenFacts({ hiddenByCascade: null }, 'de-01', byNode)).toBeNull();
  });

  it('7. у хоста ключа нет (старый бэкенд), у ноды есть: говорит нода; у ноды тоже нет: молчим', () => {
    expect(hostHiddenFacts({}, 'de-01', byNode)?.cascadeId).toBe('c2');
    expect(hostHiddenFacts({}, 'de-01', {})).toBeNull();
    expect(hostHiddenFacts(undefined, 'de-01', { hiddenByCascade: null })).toBeNull();
  });
});
