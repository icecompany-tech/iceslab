import type { EngineName, NodeCoreVersions } from '@iceslab/shared';
import type { Node } from '@/lib/domain/nodes';
import { coreVersionFacts, type CoreVersionLine } from '@/lib/domain/coreVersions';

/**
 * The core a profile needs, on one node, as the deploy window and the host form
 * say it before a save (owner's decision 24.09, docs/plan/core-lifecycle.md
 * section 6).
 *
 * The same reading as the BACK gate (node-core-gate.ts assertCoreOnNode), so a
 * row the screen offers is a row the server takes:
 *
 *   silent   the node has no row for this engine: never reported, an agent
 *            older than `engine`, or one that does not know the engine. Not a
 *            refusal: an incomplete fact is not a fact;
 *   missing  every row of the engine says `installed: false`. Blocks;
 *   refused  a reported version is known-bad or above the ceiling. Blocks;
 *   drift    a version other than the pin or the node's chosen one. Allowed;
 *   present  on the pin or the chosen version, or installed without a version
 *            the contract can read (`lines` empty). Allowed.
 *
 * Versions are judged by coreVersionFacts, i.e. the contract's judgeCoreVersion
 * against the node's own `coreVersions`; AmneziaWG gives two lines (module and
 * tools) under one engine.
 */
export type NodeCoreFit =
  | { kind: 'silent'; engine: EngineName }
  | { kind: 'missing'; engine: EngineName }
  | { kind: 'refused'; engine: EngineName; line: CoreVersionLine; reason: string }
  | { kind: 'drift'; engine: EngineName; lines: CoreVersionLine[] }
  | { kind: 'present'; engine: EngineName; lines: CoreVersionLine[] };

export function nodeCoreFit(
  node: Pick<Node, 'cores' | 'coreVersions'>,
  engine: EngineName,
): NodeCoreFit {
  const cores = node.cores ?? null;
  // Strictly `engine`, not `engine ?? name`: the gate cannot tell a row
  // without it, and a screen that guessed would promise what the save refuses.
  const rows = cores?.cores.filter((c) => c.engine === engine) ?? [];
  if (rows.length === 0) return { kind: 'silent', engine };
  const present = rows.filter((c) => c.installed !== false);
  if (present.length === 0) return { kind: 'missing', engine };

  const intent: NodeCoreVersions = node.coreVersions ?? {};
  const seen = new Set<string>();
  const lines: CoreVersionLine[] = [];
  for (const row of present) {
    for (const line of coreVersionFacts(row, cores?.arch, intent)) {
      if (seen.has(line.component)) continue;
      seen.add(line.component);
      lines.push(line);
    }
  }
  for (const line of lines) {
    const v = line.verdict;
    if (v.kind === 'known-bad' || v.kind === 'above-ceiling') {
      return { kind: 'refused', engine, line, reason: v.reason };
    }
  }
  if (lines.some((l) => l.verdict.kind === 'drift')) return { kind: 'drift', engine, lines };
  return { kind: 'present', engine, lines };
}

/** Whether the row may be ticked for a NEW binding. One already there can
 *  always be unticked: the screen must not trap a host on a broken node. */
export function nodeCoreBlocks(fit: NodeCoreFit): boolean {
  return fit.kind === 'missing' || fit.kind === 'refused';
}

export type NodeCoreTone = 'amber' | 'red' | 'grey';

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The core's name as an operator types it on the node. */
function coreName(engine: EngineName): string {
  return engine === 'singbox' ? 'sing-box' : engine;
}

function versions(lines: CoreVersionLine[], t: T, pick: (l: CoreVersionLine) => string): string {
  return lines.map((l) => (l.part ? `${t(`nodeCore.part.${l.part}`)} ${pick(l)}` : pick(l))).join(', ');
}

/**
 * The line under the node, its colour, and for a blocking one the reason the
 * tick is not offered (the title of the dead checkbox).
 */
export function nodeCoreFitText(fit: NodeCoreFit, t: T): { tone: NodeCoreTone; text: string; blockWhy: string | null } {
  const core = coreName(fit.engine);
  switch (fit.kind) {
    case 'silent':
      return { tone: 'grey', text: t('nodeCore.silent'), blockWhy: null };
    case 'missing':
      return {
        tone: 'amber',
        text: t('nodeCore.missing', { core }),
        blockWhy: t('nodeCore.missingWhy', { core }),
      };
    case 'refused': {
      // The manifest's reason is a paragraph: it goes where it can be read in
      // full (the title), the line stays one line.
      const version = versions([fit.line], t, (l) => l.reported);
      return {
        tone: 'red',
        text: t('nodeCore.refused', { core, version }),
        blockWhy: t('nodeCore.refusedWhy', { core, version, reason: fit.reason }),
      };
    }
    case 'drift': {
      const drifted = fit.lines.filter((l) => l.verdict.kind === 'drift');
      const toPin = drifted.every((l) => l.targetIsPin);
      return {
        tone: 'amber',
        text: t(toPin ? 'nodeCore.driftPin' : 'nodeCore.driftChosen', {
          core,
          version: versions(drifted, t, (l) => l.reported),
          target: versions(drifted, t, (l) => (l.verdict.kind === 'drift' ? l.verdict.intended : '')),
        }),
        blockWhy: null,
      };
    }
    case 'present': {
      if (fit.lines.length === 0) return { tone: 'grey', text: t('nodeCore.noVersion', { core }), blockWhy: null };
      // caddy-naive has no pin at all (built from a branch): «как в пине»
      // would be a claim about nothing.
      const unpinned = fit.lines.some((l) => l.verdict.kind === 'unpinned');
      const onPin = fit.lines.every((l) => l.verdict.kind === 'intended' && l.verdict.isPin);
      return {
        tone: 'grey',
        text: t(unpinned ? 'nodeCore.unpinned' : onPin ? 'nodeCore.onPin' : 'nodeCore.onChosen', {
          core,
          version: versions(fit.lines, t, (l) => l.reported),
        }),
        blockWhy: null,
      };
    }
  }
}
