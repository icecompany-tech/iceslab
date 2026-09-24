import type { EngineName } from '@iceslab/shared';
import { intendedEngines, nativeEngineFor } from './node-engines.js';

/**
 * Node.intendedEngines: which engines the node is SET UP to carry (owner's
 * decision 24.09, docs/plan/core-lifecycle.md section 7).
 *
 * An intent. Nothing gates on it: the gates read the report (`cores`,
 * reportedEngines), because "the operator asked for it" is not "the machine
 * has it". The installer takes it as `--engines`, the node card shows it.
 *
 * The first entry is the PRIMARY engine, the one `protocol` names
 * (nativeEngineFor(protocol) === intendedEngines[0]); the order of the rest
 * means nothing. `protocol` stays the install label it always was (it tells
 * shadowsocks from xray and tuic from anytls, which an engine does not), and
 * `singboxEngine` is exactly "singbox is in the list". Both are stored and
 * kept in step on every write, so nothing that reads them changes.
 */

/** The protocols a node can be installed as, i.e. what `--protocol` takes. */
const NODE_PROTOCOLS = [
  'xray',
  'hysteria',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
  'tuic',
  'anytls',
  'shadowtls',
] as const;

export class NodeEnginesError extends Error {
  readonly code = 'INVALID_ENGINES';
  constructor(
    message: string,
    /** The body field the refusal is about. */
    public path: 'intendedEngines' | 'protocol' | 'singboxEngine',
  ) {
    super(message);
    this.name = 'NodeEnginesError';
  }
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
 * update body. Each may come alone, and absent means "no edit":
 *
 *   intendedEngines  sets the list. `protocol`, when also sent, has to be
 *                    served by the first engine; when not sent it is kept if it
 *                    still is, else it becomes the first engine. A sing-box
 *                    primary has no protocol of its own name, so it needs one
 *                    sent (tuic, anytls or shadowtls). `singboxEngine`, when
 *                    also sent, has to agree with the list.
 *   protocol alone   moves the primary to its engine; the other engines stay.
 *   singboxEngine    the old toggle: adds or removes sing-box (never the
 *   alone            primary).
 *
 * Throws NodeEnginesError on a contradiction rather than picking a side.
 */
export function resolveNodeEngines(input: NodeEnginesInput, stored?: NodeEngines): NodeEngines {
  if (input.intendedEngines !== undefined) {
    const engines = input.intendedEngines;
    const primary = engines[0]!;
    let protocol: string;
    if (input.protocol !== undefined) {
      if (nativeEngineFor(input.protocol) !== primary) {
        throw new NodeEnginesError(
          `protocol "${input.protocol}" is served by ${nativeEngineFor(input.protocol)}, not by the first engine ${primary}`,
          'protocol',
        );
      }
      protocol = input.protocol;
    } else if (stored && nativeEngineFor(stored.protocol) === primary) {
      protocol = stored.protocol;
    } else if ((NODE_PROTOCOLS as readonly string[]).includes(primary)) {
      protocol = primary;
    } else {
      throw new NodeEnginesError(
        'a sing-box primary needs its protocol named: tuic, anytls or shadowtls',
        'protocol',
      );
    }
    const singboxEngine = engines.includes('singbox');
    if (input.singboxEngine !== undefined && input.singboxEngine !== singboxEngine) {
      throw new NodeEnginesError(
        `singboxEngine ${input.singboxEngine} contradicts intendedEngines [${engines.join(', ')}]`,
        'singboxEngine',
      );
    }
    return { intendedEngines: [...engines], protocol, singboxEngine };
  }

  const protocol = input.protocol ?? stored?.protocol ?? 'xray';
  const primary = nativeEngineFor(protocol);
  const before = stored ? readIntendedEngines(stored) : [];
  let engines: EngineName[] = [primary, ...before.filter((e) => e !== primary)];
  if (input.singboxEngine === true && !engines.includes('singbox')) engines.push('singbox');
  if (input.singboxEngine === false && primary !== 'singbox') {
    engines = engines.filter((e) => e !== 'singbox');
  }
  return { intendedEngines: engines, protocol, singboxEngine: engines.includes('singbox') };
}
