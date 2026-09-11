import type { Node } from '@/lib/domain/nodes';
import { protocolLabelCompact } from '@/lib/domain/protocols';

/**
 * The pair (protocol, engine), which is what the dispatcher on a node actually
 * matches and what the panel used to show half of.
 *
 * «hy2» in a list is not an answer: Hysteria 2 is served by its own daemon, by
 * sing-box, and (from xray v26.3.27) by xray. They have different configs,
 * different statistics, and different ability to carry a cascade leg. An
 * operator who picks the word without the engine does not know which of the
 * three they will get, and finds out in the field.
 *
 * The engine names here are the panel's, not a wire format: `native` means the
 * protocol's own daemon.
 */
export type EngineName = 'xray' | 'singbox' | 'native';

export interface EnginePair {
  /** Protocol enum value, or a link-cell name where the pair describes a link. */
  protocol: string;
  engine: EngineName;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

export function engineWord(engine: EngineName, t: T): string {
  return t(`engine.${engine}`);
}

/** «Hysteria 2 · свой демон». One place, so the two halves never drift apart
 *  across the screens that print them. */
export function pairLabel(pair: EnginePair, t: T): string {
  return t('engine.pair', {
    protocol: protocolLabelCompact(pair.protocol),
    engine: engineWord(pair.engine, t),
  });
}

/**
 * The engine that serves a node's own protocol.
 *
 * `singboxEngine` is NOT this answer: it says sing-box is installed ALONGSIDE
 * the native core, so it widens what the node can serve without changing what
 * its own protocol runs on. The three sing-box-only protocols have no native
 * daemon, so for them the engine is sing-box by definition.
 *
 * Replaced by `node.cores[]` once the agent reports it: this function reads the
 * install-time intent, the inventory will read the machine.
 */
const SINGBOX_ONLY = new Set(['tuic', 'anytls', 'shadowtls']);

export function nodePair(node: Pick<Node, 'protocol'>): EnginePair {
  if (node.protocol === 'xray') return { protocol: 'xray', engine: 'xray' };
  if (SINGBOX_ONLY.has(node.protocol)) return { protocol: node.protocol, engine: 'singbox' };
  return { protocol: node.protocol, engine: 'native' };
}

/**
 * What a pair LOSES compared with the same protocol on another engine.
 *
 * The label says which two things were paired; this says what the pairing
 * costs, and it is the half an operator cannot look up. Hysteria 2 on xray has
 * no Salamander obfuscation at all, and in RU that is the part that gets
 * through the DPI, so «Hysteria 2 · ядро xray» without the caveat reads as the
 * same product served by a different binary, which it is not.
 *
 * Keyed by the pair, never by the protocol: the same protocol on its own daemon
 * has nothing to warn about. Empty today for every pair the panel can show,
 * because the one caveat that exists belongs to a pair the backend does not
 * offer yet (the link builder cannot see the engine). The slot is here so the
 * row already has room for it, and so the second caveat has somewhere to go
 * instead of being bolted onto a screen.
 */
const PAIR_CAVEATS: Record<string, string[]> = {
  'hysteria:xray': ['engine.caveat.noSalamander'],
};

/** i18n keys of the caveats on this pair, in the order they should be read. */
export function pairCaveats(pair: EnginePair): string[] {
  return PAIR_CAVEATS[`${pair.protocol}:${pair.engine}`] ?? [];
}

/**
 * Can a node with this protocol carry a leg of a cascade.
 *
 * Not a guess: both realised link cells (vless and shadowsocks-2022) are built
 * into the xray config of the node, see
 * apps/panel-backend/src/modules/cascades/cascade.config.ts:16-18. A machine
 * whose core is its own daemon has no xray to put the link into, so it can be a
 * way out but never a hop in the middle.
 *
 * Reads the protocol rather than `cores[]` because that field is not in the API
 * yet. When it lands this becomes «is there an xray among the cores», which is
 * the same question asked of the machine instead of of the intent.
 */
export function carriesCascadeLink(protocol: string): boolean {
  return protocol === 'xray';
}

/**
 * The link cells a cascade can actually be built from, mirroring LINK_CELLS in
 * cascade.config.ts. Stored `xray` means the vless cell: the column holds an
 * engine name for historical reasons, which is exactly the confusion this
 * module exists to end, so the panel prints the pair and keeps sending the
 * value the backend stores.
 *
 * Deliberately short. Everything else the picker used to offer is refused at
 * save since aacaa0c, and an option that cannot be saved is a dead control.
 */
export const LINK_CELLS: { value: string; pair: EnginePair }[] = [
  { value: 'xray', pair: { protocol: 'vless', engine: 'xray' } },
  { value: 'shadowsocks', pair: { protocol: 'shadowsocks', engine: 'xray' } },
];

const LINK_CELL_VALUES = new Set(LINK_CELLS.map((c) => c.value));

/** A stored value the backend would accept today. `vless` is the cell named
 *  directly and is legal too, so it is not offered twice but is not called
 *  wrong either. */
export function isRealisedLinkCell(value: string | null | undefined): boolean {
  return value === 'vless' || (Boolean(value) && LINK_CELL_VALUES.has(value as string));
}

/**
 * Options for a link-cell field. A value already stored that no cell realises
 * stays in the list so the operator can see what the row holds: dropping it
 * would show an empty select over data that exists, which reads as loss.
 */
export function linkCellOptions(
  current: string | null,
  t: T,
): { value: string; label: string }[] {
  const options = LINK_CELLS.map((c) => ({ value: c.value, label: pairLabel(c.pair, t) }));
  if (current === 'vless') {
    options.push({ value: 'vless', label: pairLabel({ protocol: 'vless', engine: 'xray' }, t) });
  } else if (current && !LINK_CELL_VALUES.has(current)) {
    options.push({ value: current, label: t('engine.cellUnrealised', { name: current }) });
  }
  return options;
}
