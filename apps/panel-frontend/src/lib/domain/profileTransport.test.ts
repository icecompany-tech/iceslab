import { describe, expect, it } from 'vitest';
import { profileTransport } from '@/lib/domain/profileTransport';
import type { Profile } from '@/lib/domain/profiles';

/**
 * На каком транспорте слушает профиль.
 *
 * Тест сторожит не саму таблицу протоколов (она в shared и проверена там), а то,
 * что панель спрашивает транспорт У ПРОФИЛЯ ЦЕЛИКОМ. Разница видна ровно в одном
 * месте: xray с `network: "kcp"` слушает udp, а по имени протокола он tcp. На
 * этом обжёгся бэкенд, и функция принимает профиль именно затем, чтобы позвать
 * её мимо конфига было нельзя.
 */

/**
 * Профиль для проверки. `config` объявлен свободно намеренно: тест нарочно
 * подсовывает сочетания, которые строгий тип инбаунда не собрал бы (kcp у
 * протокола, где его не ждут), а функция обязана пережить ровно их.
 */
function profile(p: { protocol: Profile['protocol']; config?: unknown }): Profile {
  return { id: 'p', name: 'p', ...p } as unknown as Profile;
}

describe('profileTransport', () => {
  it('1. xray с network kcp это udp, хотя таблица по протоколу сказала бы tcp', () => {
    expect(profileTransport(profile({ protocol: 'xray', config: { network: 'kcp' } }))).toBe('udp');
  });

  it('2. xray без network это tcp', () => {
    expect(profileTransport(profile({ protocol: 'xray', config: {} }))).toBe('tcp');
  });

  it('3. xray с обычным network остаётся tcp', () => {
    expect(profileTransport(profile({ protocol: 'xray', config: { network: 'ws' } }))).toBe('tcp');
  });

  it('4. hysteria всегда udp, конфиг на это не влияет', () => {
    expect(profileTransport(profile({ protocol: 'hysteria', config: {} }))).toBe('udp');
    expect(profileTransport(profile({ protocol: 'hysteria', config: { network: 'tcp' } }))).toBe('udp');
  });

  it('5. профиль не выбран: tcp, потому что проверять всё равно нечего', () => {
    expect(profileTransport(null)).toBe('tcp');
    expect(profileTransport(undefined)).toBe('tcp');
  });

  it('6. конфиг отсутствует как значение: не падаем и отвечаем по протоколу', () => {
    expect(profileTransport(profile({ protocol: 'xray', config: null }))).toBe('tcp');
    expect(profileTransport(profile({ protocol: 'amneziawg', config: null }))).toBe('udp');
  });
});
