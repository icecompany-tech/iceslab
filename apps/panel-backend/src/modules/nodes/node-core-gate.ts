import {
  AWG_PROTOCOLS,
  type AwgProtocol,
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
 * A 3.1 AmneziaWG profile onto a node whose module speaks 1.x only (t07-1).
 *
 * One way only. A 3.1 module carries a 1.x interface beside a 3.1 one (Ф7.0 m1
 * on se-02, and the 1.x interface set by tools 3.1 there on 26.09), so a 1.x
 * profile on a 3.1 node is served and is not refused: refusing it would refuse
 * every 1.x profile on a node the moment its bootstrap moved it to 3.1.
 */
export class AwgProtocolMismatchError extends Error {
  readonly code = 'AWG_PROTOCOL_MISMATCH';
  constructor(
    public nodeName: string,
    /** What the profile hands out. */
    public profileAwgProtocol: AwgProtocol,
    /** What the node's module speaks, from its report. */
    public nodeAwgProtocol: AwgProtocol,
  ) {
    super(
      `Node "${nodeName}" runs the AmneziaWG ${awgName(nodeAwgProtocol)} kernel module, which cannot serve ` +
        `a ${awgName(profileAwgProtocol)} profile. Rerun the AmneziaWG bootstrap on the node to move it to 3.1.`,
    );
    this.name = 'AwgProtocolMismatchError';
  }
}

function awgName(g: AwgProtocol): string {
  return g === 3 ? '3.1' : '1.x';
}

/**
 * The AmneziaWG generation a node's module speaks, by its report, or null when
 * the report does not say: never reported, no amneziawg row, the core not
 * installed, or a module version that does not tell (an agent older than the
 * field, a raw 1.0.0 build). null is not 1, and nothing refuses on it.
 */
export function reportedAwgProtocol(cores: NodeCores | null): AwgProtocol | null {
  const row = cores?.cores.find(
    (c) => c.name === 'amneziawg' && (c.engine === undefined || c.engine === 'amneziawg') && c.installed !== false,
  );
  const g = row?.awgProtocol;
  return g !== undefined && AWG_PROTOCOLS.includes(g) ? g : null;
}

/**
 * The generation a profile hands out: its own, and 1 when it names none, which
 * is every AmneziaWG profile made before phase 7. null for any other protocol.
 */
export function profileAwgProtocol(profile: { protocol: string; awgProtocol?: number | null }): AwgProtocol | null {
  if (profile.protocol !== 'amneziawg') return null;
  return profile.awgProtocol === 3 ? 3 : 1;
}

/**
 * The generation half of the gate, on the same rule: a node that has not said
 * which module it runs is let through.
 */
export function assertAwgProtocolOnNode(
  node: { name: string; cores: unknown },
  profile: { protocol: string; awgProtocol?: number | null },
): void {
  const wanted = profileAwgProtocol(profile);
  if (wanted !== 3) return;
  const has = reportedAwgProtocol((node.cores as NodeCores | null) ?? null);
  if (has === 1) throw new AwgProtocolMismatchError(node.name, wanted, has);
}

/**
 * The 409 each refusal above answers with, or null for any other error. One shape
 * for POST /api/hosts and POST /api/bindings, so one screen draws both.
 *
 * (E30b's HYSTERIA_NEEDS_HOSTNAME, f73ba50, stood here for one day: native
 * hysteria on a node addressed by IP now serves the panel's self-signed pair,
 * E30a, and needs no domain.)
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
  if (err instanceof AwgProtocolMismatchError) {
    return {
      status: 409,
      body: {
        error: err.code,
        message: err.message,
        nodeName: err.nodeName,
        profileAwgProtocol: err.profileAwgProtocol,
        nodeAwgProtocol: err.nodeAwgProtocol,
      },
    };
  }
  return null;
}

/**
 * The gate. `profile` is what the host will be served by; its engine is the
 * one that has to be on the node, and for AmneziaWG its generation the one the
 * node's module has to speak (after the install and the version: those carry
 * the command that fixes them).
 */
export function assertCoreOnNode(
  node: { name: string; cores: unknown; coreVersions: unknown },
  profile: { protocol: string; engine: string | null; awgProtocol?: number | null },
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
  assertAwgProtocolOnNode(node, profile);
}

/**
 * Which core row serves a profile: the row of the profile's protocol on the
 * engine that renders it. A core row is one ADAPTER (`name` = protocol,
 * `engine`), not one engine: a node carries xray[xray] and shadowsocks[xray]
 * side by side, and an xray host needs the first and not the second. Keying
 * by engine alone put "needed by 1" on both (stand, 24.09).
 */
function coreRowKey(protocol: string, engine: string): string {
  return `${protocol}|${engine}`;
}

/**
 * How many enabled hosts on each node each core row serves: the hint beside a
 * core in the node's "Cores" section ("this core is needed by N hosts"). A
 * host counts when it and its binding are both enabled, because a disabled
 * binding is not deployed. One query for any number of nodes.
 */
export async function hostsByEngine(nodeIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (nodeIds.length === 0) return out;
  const hosts = await prisma.host.findMany({
    where: { enabled: true, binding: { enabled: true, nodeId: { in: nodeIds } } },
    select: { binding: { select: { nodeId: true, profile: { select: { protocol: true, engine: true } } } } },
  });
  for (const h of hosts) {
    const key = coreRowKey(h.binding.profile.protocol, effectiveEngineOf(h.binding.profile));
    const perNode = out.get(h.binding.nodeId) ?? new Map<string, number>();
    perNode.set(key, (perNode.get(key) ?? 0) + 1);
    out.set(h.binding.nodeId, perNode);
  }
  return out;
}

/**
 * The report with `neededBy` on every row that names its engine (zero for a
 * core no host needs). A row without `engine` is an agent older than the
 * field: which adapter it is cannot be told, so it gets no key, not a guess.
 */
export function withNeededBy(
  cores: NodeCores | null,
  counts: Map<string, number> | undefined,
): NodeCores | null {
  if (!cores) return cores;
  return {
    ...cores,
    cores: cores.cores.map((c): NodeCoreInfo =>
      c.engine === undefined ? c : { ...c, neededBy: counts?.get(coreRowKey(c.name, c.engine)) ?? 0 },
    ),
  };
}
