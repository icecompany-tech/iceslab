import type { SubscriptionFormat } from '@/lib/domain/srr';

/**
 * The formats a delivery rule may select, in the order the picker lists them.
 *
 * This is the SRR enum from `srr.schemas.ts`, not the wider set `/sub?format=`
 * accepts. The subscription endpoint also serves `xrayjson-array` and
 * `amneziavpn`, but a stored rule cannot name them: the rule schema predates
 * both. Offering them here would produce a 400 on save, so the picker stays
 * honest and the gap is a backend follow-up.
 */
export const SRR_FORMATS: SubscriptionFormat[] = [
  'plain',
  'xrayjson',
  'singbox',
  'clash',
  'xkeen',
  'wgconf',
  'outline',
  'surge',
  'quantumultx',
  'loon',
  'json',
];

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
