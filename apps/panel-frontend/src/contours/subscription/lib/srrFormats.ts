import { FORMAT_NAMES } from '@iceslab/shared';
import type { SubscriptionFormat } from '@/lib/domain/srr';

/**
 * Форматы, которые может выбрать правило выдачи.
 *
 * ⚠ Список из контракта, своей копии больше нет. Она стояла здесь не по
 * недосмотру: энум правил на бэкенде правда был уже, без `xrayjson-array` и
 * `amneziavpn`, и предлагать их значило бы получить 400 на сохранении. Теперь
 * правило принимает весь `FORMAT_NAMES`, и оба формата заводятся.
 */
export const SRR_FORMATS: readonly SubscriptionFormat[] = FORMAT_NAMES;

/**
 * Formats in which a balancer cascade survives. Those two expand a cascade
 * entry into one server per exit (buildXrayJsonArray / expandEndpointUris);
 * every other format serves a single config, so the client has no exit to pick.
 *
 * `xrayjson-array` is the third such format and the one built for it, which is
 * exactly why its absence from the rule enum matters.
 */
export const CASCADE_AWARE_FORMATS: SubscriptionFormat[] = ['plain'];

/** Accent per format family, so a format reads the same in the table, the
 *  picker and the tester. */
export function formatTone(f: string): string {
  if (f === 'plain') return '#A7D8B9';
  if (f === 'xrayjson' || f === 'xrayjson-array' || f === 'xkeen') return '#7DD3FC';
  if (f === 'singbox') return '#A78BFA';
  if (f === 'clash') return '#67E8F9';
  if (f === 'wgconf') return '#F5B14C';
  return '#7A8BA3';
}
