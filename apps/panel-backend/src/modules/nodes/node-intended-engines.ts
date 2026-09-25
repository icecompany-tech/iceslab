import { ENGINE_NAMES, type EngineName } from '@iceslab/shared';
import { intendedEngines, nativeEngineFor } from './node-engines.js';

/**
 * Node.intendedEngines: which engines the node is SET UP to carry (owner's
 * decision 24.09, docs/plan/core-lifecycle.md section 7).
 *
 * An intent. Nothing gates on it: the gates read the report (`cores`,
 * reportedEngines), because "the operator asked for it" is not "the machine
 * has it". The installer takes it as `--engines`, the node card shows it.
 *
 * A SET, none of it primary (owner's decision 25.09: "there should be no such
 * thing as a main core"). Kept in the fixed order of ENGINE_NAMES, so two
 * spellings of one set are one value and one install line. `protocol` is a
 * label DERIVED from the set (nodeProtocolOf), never chosen: a body that sends
 * it is heard only where nothing else names the cores (a create without
 * `intendedEngines`, the old form). `singboxEngine` is exactly "singbox is in
 * the set". Both are stored and kept in step on every write, so nothing that
 * reads them changes.
 */

export class NodeEnginesError extends Error {
  constructor(
    message: string,
    /** The body field the refusal is about. */
    public path: 'intendedEngines' | 'singboxEngine',
    /**
     * INVALID_ENGINES: the body contradicts itself. LAST_CORE: the write would
     * leave the node without a core, and a node without cores is not a node.
     */
    readonly code: 'INVALID_ENGINES' | 'LAST_CORE' = 'INVALID_ENGINES',
  ) {
    super(message);
    this.name = 'NodeEnginesError';
  }
}

/** The set in the order of ENGINE_NAMES, each engine once. */
export function engineSet(engines: readonly EngineName[]): EngineName[] {
  return ENGINE_NAMES.filter((e) => engines.includes(e));
}

/**
 * The label a node's `protocol` carries: xray when the set has it, else the
 * first of the set in the order of ENGINE_NAMES. Deterministic, so the same set
 * always reads the same, and the order the operator ticked the cores in says
 * nothing. A sing-box-only node reads `singbox`, which is an engine rather
 * than a protocol: the label is display, and no install line carries it.
 */
export function nodeProtocolOf(engines: readonly EngineName[]): string {
  return engineSet(engines)[0] ?? 'xray';
}

/**
 * The stored list as the code reads it. Empty (a row inserted without the
 * column: fixtures, seed scripts, the migration tool) is derived exactly the
 * way the migration backfilled every existing row.
 */
export function readIntendedEngines(node: {
  intendedEngines?: string[] | null;
  protocol: string;
  singboxEngine: boolean;
}): EngineName[] {
  return intendedEngines(node);
}

export interface NodeEnginesInput {
  intendedEngines?: EngineName[];
  protocol?: string;
  singboxEngine?: boolean;
}

export interface NodeEngines {
  intendedEngines: EngineName[];
  protocol: string;
  singboxEngine: boolean;
}

/**
 * The three fields as they will be stored, from a create (no `stored`) or an
 * update body. Absent means "no edit":
 *
 *   intendedEngines  the set. `singboxEngine`, when also sent, has to agree.
 *   singboxEngine    the old toggle: adds or removes sing-box.
 *   protocol         ignored, except on a create that names no set: the old
 *                    form, whose `protocol` meant "the core it runs on", the
 *                    same thing the installer still reads `--protocol` as.
 *
 * Throws NodeEnginesError on a contradiction rather than picking a side, and
 * LAST_CORE when the result would be empty.
 */
export function resolveNodeEngines(input: NodeEnginesInput, stored?: NodeEngines): NodeEngines {
  let engines: EngineName[];
  if (input.intendedEngines !== undefined) {
    engines = engineSet(input.intendedEngines);
    const singboxEngine = engines.includes('singbox');
    if (input.singboxEngine !== undefined && input.singboxEngine !== singboxEngine) {
      throw new NodeEnginesError(
        `singboxEngine ${input.singboxEngine} contradicts intendedEngines [${engines.join(', ')}]`,
        'singboxEngine',
      );
    }
  } else {
    engines = stored
      ? readIntendedEngines(stored)
      : [nativeEngineFor(input.protocol ?? 'xray')];
    if (input.singboxEngine === true) engines = engineSet([...engines, 'singbox']);
    if (input.singboxEngine === false) engines = engines.filter((e) => e !== 'singbox');
  }
  if (engines.length === 0) {
    throw new NodeEnginesError(
      'a node keeps at least one core: this would remove its last one',
      input.intendedEngines !== undefined ? 'intendedEngines' : 'singboxEngine',
      'LAST_CORE',
    );
  }
  return { intendedEngines: engines, protocol: nodeProtocolOf(engines), singboxEngine: engines.includes('singbox') };
}
