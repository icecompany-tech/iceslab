import type { EngineName, NodeCores, ProtocolName } from '@iceslab/shared';

/**
 * Which engine serves a protocol when nothing pins one.
 *
 * ⚠ This mirrors `dto.NativeEngine` in the agent (apps/node/internal/dto). Two
 * copies of one table, and they have to agree, so there is exactly ONE on this
 * side: everything in the panel and everything the panel serves to the frontend
 * resolves through here. A third copy in the browser is what this function
 * exists to prevent, which is why the profile DTO carries the resolved value
 * rather than leaving the null for somebody else to interpret.
 */
export function nativeEngineFor(protocol: string): EngineName {
  switch (protocol) {
    case 'shadowsocks':
      return 'xray';
    case 'tuic':
    case 'anytls':
    case 'shadowtls':
      return 'singbox';
    default:
      // Every other protocol IS its own core: hysteria, amneziawg, naive,
      // mieru, mtproto. The agent says the same thing (dto.NativeEngine returns
      // EngineName(p) here). Defaulting to 'xray' instead would judge an
      // AmneziaWG profile as needing xray and refuse it on an AmneziaWG node,
      // which is a gate that rejects correct configuration.
      return protocol as EngineName;
  }
}

/** The engine that will actually render this profile: the pinned one, or the
 *  protocol's native core. Never null, which is the whole point. */
export function effectiveEngineOf(profile: {
  protocol: string;
  engine: string | null;
}): EngineName {
  return (profile.engine as EngineName | null) ?? nativeEngineFor(profile.protocol);
}

/**
 * What this node REPORTED it runs, or undefined when we do not know.
 *
 * Three states, and the third is not decoration:
 *   - undefined    nothing usable was reported (see below for both ways);
 *   - []           an agent that names its engines listed none;
 *   - non-empty    the fact.
 *
 * Deliberately no boolean beside it saying whether this is fact or guess: the
 * absence IS that signal, the same idiom as `cores: null` and an absent
 * `rendersPolicy`. A flag next to the list would let the two disagree.
 *
 * ⚠ A core WITHOUT `engine` makes the whole list undefined, and that is the
 * point rather than a shortcut. An agent older than the field says only which
 * PROTOCOL each core serves, and the protocol does not name the engine: main.go
 * registers the sing-box adapter under Protocol "xray", "hysteria" and
 * "shadowsocks" (the engine-choice adapters EC2/EC3/EC4, all of them older than
 * the field), so `name: "xray"` from such an agent is a core that may be either
 * xray or sing-box. Reading it as the native core answers "xray" for a sing-box
 * node, which is the same mistake as reading `Node.protocol` as a capability
 * list, one day later. Measured on the stand 2026-09-11: a node reported three
 * engines while not one of its cores had said any.
 *
 * An incomplete list cannot be used to refuse: the entries it is missing are
 * exactly the ones that could carry the engine being asked about. Partial is
 * enough to answer yes and useless for answering no, and the gate needs no. So
 * incomplete collapses into the state that already means "we do not know": for
 * THIS question, "never reported" and "reported without engines" are the same.
 *
 * An EMPTY list stays empty, because it is complete: there is no core whose
 * engine went unsaid. That an agent with zero adapters cannot happen (main.go
 * always registers at least one) is what keeps this from mattering.
 *
 * ⚠ A core with `installed: false` is NOT an engine the node runs. Since
 * 2026-09-23 the agent reports every engine it knows, a missing one as a row
 * with `installed: false`, and counting that row would turn every gate into a
 * yes: "singbox" would be among the engines of a node with no sing-box on it.
 * It was already true of hysteria, the one adapter registered unconditionally,
 * so an xray-only node read as a hysteria node here before this line. Absent
 * `installed` (an agent older than the field) still counts, as the DTO says.
 */
export function reportedEngines(node: { cores: unknown }): EngineName[] | undefined {
  const cores = (node.cores as NodeCores | null) ?? null;
  if (!cores) return undefined;
  if (cores.cores.some((c) => c.engine === undefined)) return undefined;
  const out = new Set<EngineName>();
  for (const c of cores.cores) {
    if (c.installed === false) continue;
    out.add(c.engine as EngineName);
  }
  return [...out];
}

/**
 * What the node's own settings SUGGEST it runs.
 *
 * ⚠ Not usable as a capability list, and that is why nothing gates on it.
 * `Node.protocol` is a LABEL for which adapter is primary on that VPS, and the
 * schema says so in as many words: "the actual deployment is per-binding". A
 * node installed as xray routinely serves a hysteria profile as well, because
 * the agent registers an adapter for every protocol the operator might switch
 * on later.
 *
 * Measured on 2026-09-11: gating on this refused 23 pairs the suite creates on
 * purpose, every one of them a shape the panel supports today. Kept only for
 * display and for the message of a refusal that came from the report.
 */
export function intendedEngines(node: {
  protocol: string;
  singboxEngine: boolean;
  /** Node.intendedEngines (core-lifecycle.md section 7). Empty or absent: the
   *  row predates the column or was inserted without it, and the list is
   *  derived the way the migration backfilled it. */
  intendedEngines?: string[] | null;
}): EngineName[] {
  if (node.intendedEngines && node.intendedEngines.length > 0) {
    return [...new Set(node.intendedEngines as EngineName[])];
  }
  const out = new Set<EngineName>([nativeEngineFor(node.protocol)]);
  if (node.singboxEngine) out.add('singbox');
  return [...out];
}

/**
 * Does a core on this node render this profile?
 *
 * `undefined` means the node has never reported its cores, so the honest answer
 * is that we do not know. It is NOT false: saying "this will not come up" about
 * a node that may well be running the core is the same lie the panel told about
 * the policy, one screen over.
 *
 * This is the shape the DTO flag uses. The gate on saving is deliberately
 * different, see assertNodeRendersProfile.
 */
export function nodeRendersProfile(
  node: { cores: unknown },
  profile: { protocol: string; engine: string | null },
): boolean | undefined {
  const engines = reportedEngines(node);
  if (!engines) return undefined;
  return engines.includes(effectiveEngineOf(profile));
}

/**
 * The same question at SAVE time.
 *
 * FACT ONLY. A node that has not reported its cores is allowed, because the
 * only other thing to judge by is `Node.protocol`, and that is a label rather
 * than a capability list (see intendedEngines). The first version of this gate
 * fell back to it and refused 23 pairs the suite builds deliberately: a node
 * labelled `tuic` serving an xray profile beside it is not a mistake, it is how
 * multi-protocol nodes have always worked here.
 *
 * So the gate is quiet today, on a fleet where nothing reports yet, and becomes
 * real the day the agents are updated. That is the honest order: it can only
 * refuse what a node has actually said about itself.
 *
 * Returns the engines it judged against, so the caller can name them.
 */
export function renderableAtSave(
  node: { cores: unknown; protocol: string; singboxEngine: boolean; intendedEngines?: string[] | null },
  profile: { protocol: string; engine: string | null },
): { ok: boolean; engines: EngineName[]; wanted: EngineName; justEnabled: boolean } {
  const engines = reportedEngines(node);
  const wanted = effectiveEngineOf(profile);
  if (!engines) return { ok: true, engines: [], wanted, justEnabled: false };
  // The narrow edge: the operator switches sing-box on for a node that has
  // already reported, and between that click and the next poll the report still
  // says what it said before. The pair is legitimate and the refusal is only
  // "not yet". Falling back to intent to avoid it is what we just measured as
  // wrong, so the difference is carried in the MESSAGE instead: this is the one
  // job intendedEngines still has.
  const justEnabled = !engines.includes(wanted) && intendedEngines(node).includes(wanted);
  return { ok: engines.includes(wanted), engines, wanted, justEnabled };
}

/** Narrow helper so callers do not have to know the ProtocolName union. */
export function protocolName(p: string): ProtocolName {
  return p as ProtocolName;
}
