import { describe, expect, it } from 'vitest';
import { portRefusalOf } from '@/lib/domain/portCheck';

/**
 * Отказ сохранения по занятому порту, разобранный из ответа сервера.
 *
 * Главное здесь не три кода, а две границы. Код, которого панель не знает,
 * обязан дать `null`, иначе экран нарисует пустую фразу вместо настоящего
 * сообщения сервера. И ответ, который вообще не про порт, тоже `null`, иначе
 * чужая беда покажется человеку как «смените порт».
 */

/** Ответ axios: тело лежит в `response.data`. */
function refusal(body: unknown) {
  return { response: { data: body } };
}

describe('portRefusalOf', () => {
  it('1. профиль: код и список держателей проходят как есть', () => {
    const r = portRefusalOf(
      refusal({
        error: 'PORT_TAKEN_PROFILE',
        conflicts: [{ kind: 'profile', port: 8443, transport: 'tcp', name: 'vless-reality' }],
      }),
    );
    expect(r?.code).toBe('PORT_TAKEN_PROFILE');
    expect(r?.conflicts).toHaveLength(1);
    expect(r?.conflicts[0]).toMatchObject({ kind: 'profile', name: 'vless-reality' });
  });

  it('2. каскад', () => {
    const r = portRefusalOf(
      refusal({
        error: 'PORT_TAKEN_CASCADE',
        conflicts: [{ kind: 'cascade', port: 443, transport: 'tcp', name: 'ru-de-relay' }],
      }),
    );
    expect(r?.code).toBe('PORT_TAKEN_CASCADE');
    expect(r?.conflicts[0]).toMatchObject({ kind: 'cascade' });
  });

  it('3. служба ядра', () => {
    const r = portRefusalOf(
      refusal({
        error: 'PORT_TAKEN_CORE_SERVICE',
        conflicts: [{ kind: 'core-service', port: 10085, transport: 'tcp', ownerKey: 'xray-api' }],
      }),
    );
    expect(r?.code).toBe('PORT_TAKEN_CORE_SERVICE');
    expect(r?.conflicts[0]).toMatchObject({ ownerKey: 'xray-api' });
  });

  it('4. код без списка: разбор проходит, список пустой, экран скажет по коду', () => {
    const r = portRefusalOf(refusal({ error: 'PORT_TAKEN_PROFILE', message: 'Port 8443 taken' }));
    expect(r?.code).toBe('PORT_TAKEN_PROFILE');
    expect(r?.conflicts).toEqual([]);
  });

  it('5. чужой код: null, чтобы экран показал сообщение сервера своими словами', () => {
    expect(portRefusalOf(refusal({ error: 'TRANSPORT_MOVE_BLOCKED', message: 'no' }))).toBeNull();
    expect(portRefusalOf(refusal({ error: 'LINK_PORT_IN_USE' }))).toBeNull();
  });

  it('6. ответ не про порт вовсе: null, а не выдуманный отказ', () => {
    expect(portRefusalOf(refusal({ message: 'Validation failed' }))).toBeNull();
    expect(portRefusalOf(refusal(null))).toBeNull();
    expect(portRefusalOf(new Error('network down'))).toBeNull();
    expect(portRefusalOf(null)).toBeNull();
    expect(portRefusalOf(undefined)).toBeNull();
  });
});
