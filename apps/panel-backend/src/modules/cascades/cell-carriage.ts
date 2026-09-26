import {
  LINK_CELL_ENGINES,
  type ChainStatus,
  type EngineName,
  type LinkCell,
  type NodeCores,
} from '@iceslab/shared';
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
  // E46, stand 26.09: ru-01 -> ru-02 -> nl-01 on vless legs, no sing-box on any
  // of the three, saved without a word; every node logged "no singbox binary"
  // and "xray cascade fragments ignored", and the entry's xray sent users to a
  // link-out that did not exist. LINK_CELL_ENGINES lets xray end vless for the
  // fleet that predates the chain; an agent that says it carries legs through
  // its chain process alone (chainEngine) is not that fleet, and there the
  // chain's engine is the only receiver.
  const chainEngine = chainEngineOf(node);
  const carriers = chainEngine ? [chainEngine] : LINK_CELL_ENGINES[cell];
  return judge(node, (engines) => engines.some((e) => carriers.includes(e)), chainEngine !== undefined);
}

/** The engine the node's agent carries legs through, when it said so (E46). */
export function chainEngineOf(node: { cores: unknown }): EngineName | undefined {
  return ((node.cores as NodeCores | null) ?? null)?.chainEngine;
}

/**
 * Can this node RUN the chain process at all? Phase 6, for a hysteria entry.
 *
 * A hysteria entry has no fallback: its users reach the cascade only through
 * the chain process on the same machine (there is no legacy xray drawing for
 * hysteria). So the question is not which cell, but whether sing-box is there.
 *
 * The SAME three answers as a cell, read by the same code, for the same
 * reasons, and the absence of a chain block is again not a "no": it is how
 * every node answers before its first cascade, and the chain block is sent BY
 * this save. Refusing on it would refuse every first hysteria cascade, forever.
 * The one real refusal is a node that reported its engines in full and sing-box
 * is not among them.
 */
export function canRunChainAtSave(node: { cores: unknown; chainStatus: unknown }): CellCarriage {
  return judge(node, (engines) => engines.includes('singbox'), chainEngineOf(node) !== undefined);
}

/**
 * The three answers both questions share. See carriesCellAtSave's header.
 *
 * `chainOnly`: the agent carries legs through its chain process alone (E46).
 * Then a chain block that is present and not running is no longer a reason to
 * let the save through unread: the engines decide, because the reason it is
 * down may be exactly the missing binary ("no singbox binary on this node").
 */
function judge(
  node: { cores: unknown; chainStatus: unknown },
  enough: (engines: EngineName[]) => boolean,
  chainOnly = false,
): CellCarriage {
  const chain = (node.chainStatus as ChainStatus | null) ?? null;
  if (chain?.running === true) return { ok: true, by: 'chain', engines: [] };
  if (chain && !chainOnly) return { ok: true, by: 'unknown', engines: [] };
  const engines = reportedEngines(node);
  if (!engines) return { ok: true, by: 'unknown', engines: [] };
  return { ok: enough(engines), by: 'engines', engines };
}
