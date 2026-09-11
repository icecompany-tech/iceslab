import type { EngineName } from '@iceslab/shared';
import type { Node } from '@/lib/domain/nodes';
import { protocolLabelCompact } from '@/lib/domain/protocols';

/**
 * The pair (protocol, engine), which is what the dispatcher on a node actually
 * matches and what the panel used to show half of.
 *
 * «hy2» in a list is not an answer: Hysteria 2 is served by its own daemon, by
 * sing-box, and (from xray v26.3.27) by xray. Different config, different
 * statistics, different ability to carry a cascade leg.
 *
 * ⚠ `EngineName` comes from the shared contract, NOT from a spelling of our
 * own. Four of the seven engines are single-protocol cores whose engine name
 * equals the protocol, and the browser inventing a `native` alias beside them
 * would be a third vocabulary meeting the other two. That is exactly the trap
 * in CLAUDE.local.md: one name, two forms of value. «Свой демон» below is a
 * WORD for those engines, not a value.
 */
export type { EngineName };

export interface EnginePair {
  /** Protocol enum value, or a link-cell name where the pair describes a link. */
  protocol: string;
  engine: EngineName;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Engines that are one protocol's own core: their name says nothing an
 *  operator does not already read in the protocol, so they get one word. */
const OWN_DAEMON = new Set<EngineName>(['hysteria', 'amneziawg', 'naive', 'mieru', 'mtproto']);

/**
 * The engine inside a PAIR, where the protocol stands right next to it:
 * «Hysteria 2 · свой демон». Naming the daemon again there would repeat the
 * word the operator has already read.
 */
export function engineWord(engine: EngineName, t: T): string {
  if (engine === 'xray') return t('engine.xray');
  if (engine === 'singbox') return t('engine.singbox');
  return OWN_DAEMON.has(engine) ? t('engine.own') : engine;
}

/**
 * The engine ON ITS OWN, in a list of what a machine runs. Here the name is the
 * whole content: «свой демон» in a list of cores would say which kind of core
 * it is and not which one, so a node running AmneziaWG and one running mieru
 * would read identically.
 */
export function engineCoreWord(engine: EngineName, t: T): string {
  if (engine === 'xray') return t('engine.xray');
  if (engine === 'singbox') return t('engine.singbox');
  return engine;
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
 * The engines a node REPORTED, or undefined when it never has.
 *
 * ⚠ Nothing here is derived from `node.protocol`. That field is a LABEL saying
 * which adapter was installed as primary, not a list of what the machine can
 * run: a node labelled `tuic` routinely serves an xray profile beside it. The
 * backend measured the cost of reading it as a capability on 2026-09-11, and it
 * refused 23 legitimate pairs. So the three states are the report itself:
 *
 *   undefined   no agent has reported cores yet. Unknown, and the panel says
 *               nothing at all rather than guessing in either direction.
 *   []          it reported and runs nothing.
 *   non-empty   the fact.
 */
export function nodeEngines(node: Pick<Node, 'engines'>): EngineName[] | undefined {
  return node.engines;
}

/**
 * The node's cores in words: «ядро xray, движок sing-box».
 *
 * The two edge answers are words as well, never a blank: an empty string in a
 * sentence about what a machine runs reads as a rendering bug, and «не
 * сообщила» and «ни одного» are different facts.
 */
export function engineListWords(node: Pick<Node, 'engines'>, t: T): string {
  const engines = node.engines;
  if (!engines) return t('engine.coresUnknown');
  if (engines.length === 0) return t('engine.coresNone');
  return engines.map((e) => engineCoreWord(e, t)).join(', ');
}

/**
 * Does a core on this node render a profile whose effective engine is this?
 *
 * Membership in a reported set, which is the whole check: `effectiveEngine`
 * arrives on the profile already resolved, so the protocol-to-native-core table
 * stays on the server where it has one copy. Undefined means the node has never
 * reported, and that is NOT false.
 */
export function nodeRunsEngine(
  node: Pick<Node, 'engines'>,
  engine: EngineName,
): boolean | undefined {
  const engines = node.engines;
  if (!engines) return undefined;
  return engines.includes(engine);
}

/**
 * Can this node carry a leg of a cascade.
 *
 * Both realised link cells (vless and shadowsocks-2022) are built into the xray
 * config of the node, see cascade.config.ts:16-18 in the backend, so the
 * question is whether xray is among the cores it reported. Undefined while it
 * has reported nothing: a node may well be running xray under a label that says
 * something else.
 */
export function nodeCarriesCascadeLink(node: Pick<Node, 'engines'>): boolean | undefined {
  return nodeRunsEngine(node, 'xray');
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
