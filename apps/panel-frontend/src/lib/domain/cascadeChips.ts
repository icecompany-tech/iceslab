import type { EngineName } from '@iceslab/shared';
import type { Node } from '@/lib/domain/nodes';
import { coreVersionOf } from '@/lib/domain/coreVersion';
import { linkCellPair, nativeEngineOfIntent } from '@/lib/domain/engines';

/**
 * The cores of a node on its cascade card, as chips (owner, 24.09: one
 * uppercase badge with three versions did not fit and read as shouting).
 *
 * Shown are the engines THIS cascade uses on the node, the rest go to a hover
 * line «also on the node»:
 *
 *   entry    the engine clients land on (entryProtocol, through its native
 *            engine: shadowsocks is xray's) and the engine of the leg it dials;
 *   transit  the leg it is dialled on and the leg it dials;
 *   exit     the leg it is dialled on.
 *
 * A leg's engine comes from its cell: vless and shadowsocks are built into
 * xray (linkCellPair), hy2 and tuic are the sing-box chain. An unset cell is
 * the entry's default leg, vless, i.e. xray.
 *
 * Versions are each core's own (coreVersionOf over cores[].version), never
 * `node.coreVersion` beside anything but xray, and only then when the node
 * reported no cores at all: that field is xray's alone.
 */
export type CascadeRole = 'entry' | 'transit' | 'exit';

export interface CascadeLegs {
  /** The entry's client-facing protocol (entry only). */
  entryProtocol?: string | null;
  /** The cell of the leg this node is dialled on (transit, exit). */
  inLeg?: string | null;
  /** The cell of the leg this node dials (entry, transit). */
  outLeg?: string | null;
  /** What the incoming / outgoing leg rides on (phase 8): `awg` raises an
   *  AmneziaWG tunnel on both ends, so the node uses AWG for the cascade too. */
  inUnderlay?: string | null;
  outUnderlay?: string | null;
}

export interface CoreChip {
  engine: EngineName;
  /** Short name, never «ядро»: `xray`, `sing-box`, `AWG`. */
  label: string;
  version: string | null;
}

const LABEL: Partial<Record<EngineName, string>> = { singbox: 'sing-box', amneziawg: 'AWG' };

export function legEngine(cell: string | null | undefined): EngineName {
  if (cell === 'hy2' || cell === 'tuic') return 'singbox';
  return linkCellPair(cell ?? 'vless')?.engine ?? 'xray';
}

function chip(node: Pick<Node, 'cores' | 'coreVersion'>, engine: EngineName): CoreChip {
  const rows = node.cores?.cores ?? [];
  const version =
    rows
      .filter((c) => c.engine === engine)
      .map(coreVersionOf)
      .find((v): v is string => v !== null) ??
    (engine === 'xray' && rows.length === 0 ? (node.coreVersion?.trim() || null) : null);
  return { engine, label: LABEL[engine] ?? engine, version };
}

export function cascadeNodeChips(
  node: Pick<Node, 'cores' | 'coreVersion'>,
  role: CascadeRole,
  legs: CascadeLegs,
): { shown: CoreChip[]; others: CoreChip[] } {
  const used: EngineName[] = [];
  const add = (e: EngineName) => {
    if (!used.includes(e)) used.push(e);
  };
  if (role === 'entry' && legs.entryProtocol) add(nativeEngineOfIntent(legs.entryProtocol));
  // `undefined` is «this screen does not know the leg» and adds nothing; `null`
  // is an unset cell, i.e. the default vless leg on xray.
  if (role !== 'entry' && legs.inLeg !== undefined) add(legEngine(legs.inLeg));
  if (role !== 'exit' && legs.outLeg !== undefined) add(legEngine(legs.outLeg));
  // A leg inside an AmneziaWG tunnel: both ends raise it.
  if ((role !== 'entry' && legs.inUnderlay === 'awg') || (role !== 'exit' && legs.outUnderlay === 'awg')) {
    add('amneziawg');
  }

  // «Also on the node»: engines it reported as installed, beyond the used ones.
  const others: EngineName[] = [];
  for (const c of node.cores?.cores ?? []) {
    if (c.installed === false || !c.engine) continue;
    if (!used.includes(c.engine) && !others.includes(c.engine)) others.push(c.engine);
  }
  return { shown: used.map((e) => chip(node, e)), others: others.map((e) => chip(node, e)) };
}

/** One chip as text: `xray 26.3.27`, `AWG`. */
export function coreChipText(c: CoreChip): string {
  return c.version ? `${c.label} ${c.version}` : c.label;
}
