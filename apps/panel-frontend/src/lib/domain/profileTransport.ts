import { transportOf, type Transport } from '@iceslab/shared';
import type { Profile } from '@/lib/domain/profiles';

/**
 * Транспорт, на котором слушает ЭТОТ профиль.
 *
 * Обёртка существует ради одной вещи: она принимает профиль ЦЕЛИКОМ и потому
 * не даёт позвать `transportOf` по одному имени протокола. У xray с
 * `network: "kcp"` транспорт udp, и таблица, ключённая на протокол, этого не
 * видит. Бэкенд ровно на этом обжёгся: инбаунд с kcp числился как TCP и
 * конфликтовал с REALITY, который ему не мешал.
 *
 * `null` это «профиль ещё не выбран», и тогда tcp как наименее удивительный
 * ответ: проверять порт всё равно не на чем.
 */
export function profileTransport(profile: Profile | null | undefined): Transport {
  if (!profile) return 'tcp';
  return transportOf(profile.protocol, profile.config as { network?: string } | null);
}
