import type { Transport } from '@iceslab/shared';
import type { Node } from '@/lib/domain/nodes';
import { nodeRunsEngine } from '@/lib/domain/engines';

/**
 * Диапазон port hopping hysteria на ноде, по умолчанию. Установщик ноды ставит
 * NAT-перенаправление этого диапазона на порт hysteria; нода свой диапазон пока
 * не сообщает, поэтому берётся этот.
 */
export const DEFAULT_HOP_RANGE = { from: 20000, to: 50000 } as const;

/**
 * Попадает ли UDP-порт профиля в диапазон port hopping hysteria этой ноды
 * (ARCH 26.09). Предупреждение, не отказ: сохранение пройдёт, но для этого
 * порта hopping выключается, и клиенты hysteria на нём не соединятся.
 *
 * Только по факту: hysteria среди движков, которые нода сообщила. Нода не
 * отчитывалась: молчит, как и остальные строки по ядрам.
 */
export function portInHopRange(
  transport: Transport,
  port: number | '' | null | undefined,
  node: Pick<Node, 'engines'>,
  range: { from: number; to: number } = DEFAULT_HOP_RANGE,
): boolean {
  if (transport !== 'udp') return false;
  if (typeof port !== 'number' || !Number.isInteger(port)) return false;
  if (port < range.from || port > range.to) return false;
  return nodeRunsEngine(node, 'hysteria') === true;
}
