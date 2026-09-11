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
 * What this node REPORTED it runs, or undefined when it never has.
 *
 * Three states, and the third is not decoration:
 *   - undefined    the node has not checked in with an agent that reports cores;
 *   - []           it checked in and renders nothing (an agent with no adapters);
 *   - non-empty    the fact.
 *
 * Deliberately no boolean beside it saying whether this is fact or guess: the
 * absence IS that signal, the same idiom as `cores: null` and an absent
 * `rendersPolicy`. A flag next to the list would let the two disagree.
 */
export function reportedEngines(node: { cores: unknown }): EngineName[] | undefined {
  const cores = (node.cores as NodeCores | null) ?? null;
  if (!cores) return undefined;
  const out = new Set<EngineName>();
  for (const c of cores.cores) {
    // `engine` is absent on an agent older than the field; the protocol's
    // native core is the honest reading for those, and it is what that agent
    // was running anyway.
    out.add((c.engine as EngineName | undefined) ?? nativeEngineFor(c.name));
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
}): EngineName[] {
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
  node: { cores: unknown },
  profile: { protocol: string; engine: string | null },
): { ok: boolean; engines: EngineName[]; wanted: EngineName } {
  const engines = reportedEngines(node);
  const wanted = effectiveEngineOf(profile);
  if (!engines) return { ok: true, engines: [], wanted };
  return { ok: engines.includes(wanted), engines, wanted };
}

/** Narrow helper so callers do not have to know the ProtocolName union. */
export function protocolName(p: string): ProtocolName {
  return p as ProtocolName;
}
