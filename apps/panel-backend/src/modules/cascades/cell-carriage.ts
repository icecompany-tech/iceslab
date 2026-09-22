import { LINK_CELL_ENGINES, type ChainStatus, type EngineName, type LinkCell } from '@iceslab/shared';
import { reportedEngines } from '../nodes/node-engines.js';

/**
 * How the answer was reached. Carried out of the function because a refusal has
 * to say what it judged by, and because two of the three are not refusals at
 * all.
 */
export type CarriageBasis = 'chain' | 'engines' | 'unknown';

export interface CellCarriage {
  ok: boolean;
  by: CarriageBasis;
  /** The engines the node reported, when that is what the answer rests on.
   *  Empty otherwise, including when the node reported none. */
  engines: EngineName[];
}

/**
 * Can this node TERMINATE a leg of this cell?
 *
 * The receiving side of a leg is either the chain process, which is sing-box
 * and therefore ends every cell there is, or, on the fleet that predates the
 * chain, the node's own xray, which ends `vless` and `shadowsocks` and has
 * never ended a QUIC one. So there are two facts to read and one non-fact:
 *
 *   - `chainStatus.running` is the fact that ends the question. A running chain
 *     process is sing-box on that machine, whatever its cores say, and
 *     LINK_CELL_ENGINES lists sing-box for all four cells. Its `version` is not
 *     compared against anything here: every version that has ever shipped the
 *     chain speaks all four, so a comparison would be a rule invented to look
 *     careful;
 *
 *   - a chain block that is present and NOT running proves nothing either way.
 *     The binary is there (the agent answered about it), and the reason it is
 *     down may well be the config we are about to replace. Reading it as "no"
 *     would refuse a cascade because a previous save of the same cascade was
 *     broken;
 *
 *   - with no chain block at all, the engines are all there is, and
 *     `reportedEngines` already answers `undefined` for a report that cannot be
 *     trusted (see its header: one core without `engine` makes the whole list
 *     unusable). Undefined is allowed through, because the gate needs "no" and
 *     an incomplete list can only give "yes".
 *
 * ⚠ The absence of a chain block is NOT evidence of an old agent, and nothing
 * here treats it as such. A current agent that has never been part of a cascade
 * reports exactly the same absence, which is every node the first time an
 * operator builds one. That is why the engines and not the absence decide:
 * `singbox` among them carries a QUIC cell whether or not a chain has ever run
 * there, and a node that reported only `xray` is the one real refusal.
 *
 * Quiet on today's fleet and honest about it: a node that reports nothing is
 * allowed, its leg fails on the node, and the failure surfaces where every
 * other push failure does, in `lastInboundSyncError`.
 */
export function carriesCellAtSave(
  node: { cores: unknown; chainStatus: unknown },
  cell: LinkCell,
): CellCarriage {
  const chain = (node.chainStatus as ChainStatus | null) ?? null;
  if (chain?.running === true) return { ok: true, by: 'chain', engines: [] };
  if (chain) return { ok: true, by: 'unknown', engines: [] };
  const engines = reportedEngines(node);
  if (!engines) return { ok: true, by: 'unknown', engines: [] };
  const carriers = LINK_CELL_ENGINES[cell];
  return { ok: engines.some((e) => carriers.includes(e)), by: 'engines', engines };
}
