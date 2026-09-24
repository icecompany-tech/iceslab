import {
  componentsOfEngine,
  coreInstallCommand,
  CORE_VERSIONS,
  judgeCoreVersion,
  type CoreComponent,
  type EngineName,
  type NodeCoreInfo,
  type NodeCores,
} from '@iceslab/shared';
import { prisma } from '../../prisma.js';
import { effectiveEngineOf } from './node-engines.js';
import { readCoreVersions } from './node-core-versions.js';

/**
 * A host does not go onto a node whose core for it is missing or known to be
 * wrong (owner's decision 24.09, docs/plan/core-lifecycle.md section 6).
 *
 * FACT ONLY, the rule every gate here follows: the engine's rows in the node's
 * report say `installed: false`, or a reported version is known-bad or above
 * the ceiling. A node that has not reported this engine, or reported it
 * without a version, is let through: an incomplete fact is not a fact. Drift
 * and the intended version are not refusals.
 *
 * ⚠ Save path only, like assertNodeRendersProfile: never from a push or a
 * rebuild, or a node whose core broke would stop receiving the config that
 * turns its hosts off.
 */

export type HowToInstall = ReturnType<typeof coreInstallCommand>;

export class CoreNotOnNodeError extends Error {
  readonly code = 'CORE_NOT_ON_NODE';
  constructor(
    public nodeName: string,
    public engine: EngineName,
    public howToInstall: HowToInstall,
  ) {
    super(`Node "${nodeName}" has no ${engine} core installed. Install it on the node first: ${howToInstall.command}`);
    this.name = 'CoreNotOnNodeError';
  }
}

export class CoreVersionRefusedError extends Error {
  readonly code = 'CORE_VERSION_REFUSED';
  constructor(
    public nodeName: string,
    public engine: EngineName,
    /** Which piece was judged: AmneziaWG reports a module and tools apart. */
    public component: CoreComponent,
    public version: string,
    public verdict: 'known-bad' | 'above-ceiling',
    public reason: string,
  ) {
    super(`Node "${nodeName}" runs ${component} ${version}, which this panel refuses (${verdict}): ${reason}`);
    this.name = 'CoreVersionRefusedError';
  }
}

/**
 * The 409 either refusal answers with, or null for any other error. One shape
 * for POST /api/hosts and POST /api/bindings, so one screen draws both.
 */
export function coreGateReply(err: unknown): { status: 409; body: Record<string, unknown> } | null {
  if (err instanceof CoreNotOnNodeError) {
    return {
      status: 409,
      body: {
        error: err.code,
        message: err.message,
        nodeName: err.nodeName,
        engine: err.engine,
        howToInstall: err.howToInstall,
      },
    };
  }
  if (err instanceof CoreVersionRefusedError) {
    return {
      status: 409,
      body: {
        error: err.code,
        message: err.message,
        nodeName: err.nodeName,
        engine: err.engine,
        component: err.component,
        version: err.version,
        verdict: err.verdict,
        reason: err.reason,
      },
    };
  }
  return null;
}

/**
 * The gate. `profile` is what the host will be served by; its engine is the
 * one that has to be on the node.
 */
export function assertCoreOnNode(
  node: { name: string; cores: unknown; coreVersions: unknown },
  profile: { protocol: string; engine: string | null },
): void {
  const engine = effectiveEngineOf(profile);
  const cores = (node.cores as NodeCores | null) ?? null;
  const rows = cores?.cores.filter((c) => c.engine === engine) ?? [];
  // Not reported (never checked in, an agent older than `engine`, or this
  // engine not among the ones the agent knows): nothing to refuse on.
  if (rows.length === 0) return;

  const present = rows.filter((c) => c.installed !== false);
  const intent = readCoreVersions(node.coreVersions);
  if (present.length === 0) {
    throw new CoreNotOnNodeError(node.name, engine, coreInstallCommand(engine, intent, cores?.arch));
  }

  for (const component of componentsOfEngine(engine)) {
    const field = CORE_VERSIONS[component].reportedBy.field;
    const reported = present.map((c) => c[field]).find((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (!reported) continue;
    const verdict = judgeCoreVersion(component, reported, intent);
    if (verdict.kind === 'known-bad' || verdict.kind === 'above-ceiling') {
      throw new CoreVersionRefusedError(node.name, engine, component, reported.trim(), verdict.kind, verdict.reason);
    }
  }
}

/**
 * How many enabled hosts on each node are served by each engine: the hint
 * beside a core in the node's "Cores" section ("this core is needed by N
 * hosts"). A host counts when it and its binding are both enabled, because a
 * disabled binding is not deployed. One query for any number of nodes.
 */
export async function hostsByEngine(nodeIds: string[]): Promise<Map<string, Map<EngineName, number>>> {
  const out = new Map<string, Map<EngineName, number>>();
  if (nodeIds.length === 0) return out;
  const hosts = await prisma.host.findMany({
    where: { enabled: true, binding: { enabled: true, nodeId: { in: nodeIds } } },
    select: { binding: { select: { nodeId: true, profile: { select: { protocol: true, engine: true } } } } },
  });
  for (const h of hosts) {
    const engine = effectiveEngineOf(h.binding.profile);
    const perNode = out.get(h.binding.nodeId) ?? new Map<EngineName, number>();
    perNode.set(engine, (perNode.get(engine) ?? 0) + 1);
    out.set(h.binding.nodeId, perNode);
  }
  return out;
}

/**
 * The report with `neededBy` on every row that names its engine (zero for an
 * engine no host needs). A row without `engine` is an agent older than the
 * field: its engine cannot be told, so it gets no key rather than a guess.
 */
export function withNeededBy(
  cores: NodeCores | null,
  counts: Map<EngineName, number> | undefined,
): NodeCores | null {
  if (!cores) return cores;
  return {
    ...cores,
    cores: cores.cores.map((c): NodeCoreInfo =>
      c.engine === undefined ? c : { ...c, neededBy: counts?.get(c.engine) ?? 0 },
    ),
  };
}
