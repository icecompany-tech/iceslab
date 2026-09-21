import { describe, expect, it } from 'vitest';
import { conflictSentence, holderWord, refusalSentence } from '@/lib/domain/portWords';
import type { PortOwner } from '@/lib/domain/portCheck';
import { hosts } from '@/i18n/locales/ru/hosts';

/**
 * Что человек прочтёт, когда порт занят.
 *
 * Проверяется РУССКИЙ текст из настоящего файла локали, а не заглушка. Заглушка
 * согласилась бы с любым ключом, в том числе с опечаткой в нём, и тест
 * подтверждал бы сам себя: ровно то, чего эти строки не должны допускать, ведь
 * по ним оператор решает, какой порт поставить.
 */

/**
 * Переводчик поверх настоящего словаря: достаёт ключ через точку и подставляет
 * `{{переменные}}`. Ключ, которого нет, возвращается КАК ЕСТЬ, потому что так
 * ведёт себя i18next, и `ownerWord` опирается именно на это поведение.
 */
function t(key: string, vars?: Record<string, unknown>): string {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    hosts,
  );
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? ''));
}

const profile: PortOwner = { kind: 'profile', port: 8443, transport: 'tcp', name: 'vless-reality' };
const cascade: PortOwner = { kind: 'cascade', port: 8443, transport: 'tcp', name: 'ru-de-relay' };
const core: PortOwner = { kind: 'core-service', port: 8443, transport: 'tcp', ownerKey: 'xray-api' };
const unknownCore: PortOwner = {
  kind: 'core-service',
  port: 9000,
  transport: 'tcp',
  ownerKey: 'brook-admin',
};

describe('conflictSentence', () => {
  it('1. профиль: называет имя и объясняет, почему второй сюда не встанет', () => {
    const s = conflictSentence(profile, t);
    expect(s).toContain('8443/tcp');
    expect(s).toContain('«vless-reality»');
    expect(s).toContain('демультиплексор');
  });

  it('2. каскад: говорит, что порт открывает сама цепь', () => {
    const s = conflictSentence(cascade, t);
    expect(s).toContain('каскадом «ru-de-relay»');
    expect(s).toContain('между хопами');
  });

  it('3. служба ядра с известным ключом: имя интерфейса, а не общее «API»', () => {
    const s = conflictSentence(core, t);
    expect(s).toContain('gRPC-API xray');
    // Loopback важен: он объясняет, почему снаружи порт выглядит свободным.
    expect(s).toContain('loopback');
  });

  it('4. неизвестный ключ службы показывается КАК ЕСТЬ, а не «неизвестная служба»', () => {
    const s = conflictSentence(unknownCore, t);
    expect(s).toContain('brook-admin');
    // Не должно протечь имя ключа локали: это была бы видимая поломка.
    expect(s).not.toContain('portCheck.owner');
  });
});

describe('holderWord', () => {
  it('5. держатель для второй фразы: у профиля и каскада имя, у службы её оборот', () => {
    expect(holderWord(profile, t)).toBe('vless-reality');
    expect(holderWord(cascade, t)).toBe('ru-de-relay');
    expect(holderWord(core, t)).toBe('gRPC-API xray');
    expect(holderWord(unknownCore, t)).toBe('brook-admin');
  });
});

describe('refusalSentence', () => {
  it('6. отказ без списка держателей: фраза по коду, и она не пустая', () => {
    const s = refusalSentence('PORT_TAKEN_PROFILE', t);
    expect(s).toContain('Сохранить не вышло');
    expect(s).toContain('другой профиль');
    // Ключ не должен остаться ключом: это значило бы, что строки в локали нет.
    expect(s).not.toContain('portCheck.refused');
  });
});
