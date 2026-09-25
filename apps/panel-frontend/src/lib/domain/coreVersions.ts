import {
  CORE_COMPONENTS,
  CORE_VERSIONS,
  componentsOfEngine,
  coreInstallCommand,
  judgeCoreVersion,
  type EngineName,
  type CoreArch,
  type CoreComponent,
  type CoreVersionVerdict,
  type NodeCoreVersions,
} from '@iceslab/shared';
import type { Node, NodeCore } from '@/lib/domain/nodes';

/**
 * A core row against the version manifest (packages/shared/core-versions.ts).
 *
 * The judge is `judgeCoreVersion` from the contract and nothing else, and the
 * variable names of every script come from `coreEnvPair`: the screen compares
 * no versions and names no variables of its own (contractCopies guards the
 * names). What lives here is only what the screen adds: which components a row
 * carries, which scripts can move them, and the PUT that states an intent.
 *
 * The intent is `Node.coreVersions`: a missing key is the pin, by the
 * manifest's own rule, so a node nobody touched follows the pin when it moves.
 */

/**
 * The AmneziaWG bootstrap leaves a loaded module and installed tools alone, so
 * running it again moves nothing (until the reinstall mode of phase 7.2). To
 * INSTALL it is fine; to MOVE a version it is not a command.
 */
const SKIPS_INSTALLED: ReadonlySet<CoreComponent> = new Set(['amneziawg-module', 'amneziawg-tools']);

export type CoreCommand =
  | { kind: 'command'; text: string }
  | { kind: 'none'; why: 'skips-installed' | 'unpinned' | 'no-arch' | 'no-asset' };

/**
 * The ssh line that moves `component` to the version the node is meant to run
 * (its intent, else the pin), or why there is none.
 *
 * The line is the contract's coreInstallCommand, the same the server puts in
 * the howToInstall of CORE_NOT_ON_NODE (dd7a8cd): one source for "install" and
 * "update", the screen writes no script path or variable of its own. To move a
 * version the pair has to be there: a line that runs the script on its own
 * defaults would install whatever the node's checkout pins, so without the
 * pair (no arch, no asset, nothing pinned) there is no command, only why.
 */
export function coreUpdateCommand(
  component: CoreComponent,
  intent: NodeCoreVersions,
  arch: CoreArch | undefined,
): CoreCommand {
  if (SKIPS_INSTALLED.has(component)) return { kind: 'none', why: 'skips-installed' };
  const engine = CORE_VERSIONS[component].reportedBy.engine as EngineName;
  const line = coreInstallCommand(engine, intent, arch);
  if (!line.pinned) return { kind: 'none', why: line.why ?? 'unpinned' };
  return { kind: 'command', text: line.command };
}

/**
 * How many enabled hosts on the node this core row's engine serves
 * (`neededBy`, dd7a8cd), as the "Cores" section says it: a hint, never a
 * source of actions. `needed` is 0 when the key is absent (a row without
 * `engine`, a server older than the field): silence, which the section draws
 * the same as zero, i.e. nothing. `brokenForHosts`: no binary on the machine
 * while hosts wait for it, the one case that stops being inventory.
 */
export function coreNeed(core: Pick<NodeCore, 'installed' | 'neededBy'>): { needed: number; brokenForHosts: boolean } {
  const needed = typeof core.neededBy === 'number' && core.neededBy > 0 ? core.neededBy : 0;
  return { needed, brokenForHosts: core.installed === false && needed > 0 };
}

/** A verdict worth a word: `unknown` stays silent. */
export type SpokenVerdict = Exclude<CoreVersionVerdict, { kind: 'unknown' }>;

export interface CoreVersionLine {
  component: CoreComponent;
  /** AmneziaWG is two versioned pieces in one row; everything else is one. */
  part: 'module' | 'tools' | null;
  reported: string;
  verdict: SpokenVerdict;
  /** Drift only: is the version it should be the pin, or the operator's choice? */
  targetIsPin: boolean;
  /** Only where the verdict asks for a move (drift, above the ceiling, known bad). */
  command: CoreCommand | null;
}

const PART: Partial<Record<CoreComponent, 'module' | 'tools'>> = {
  'amneziawg-module': 'module',
  'amneziawg-tools': 'tools',
};

/** The components a core row carries: the ones its engine reports. */
export function componentsOfCore(core: Pick<NodeCore, 'name' | 'engine'>): CoreComponent[] {
  return componentsOfEngine(core.engine ?? core.name);
}

/**
 * What a core row says about its version(s). Empty when there is nothing to
 * judge: a missing binary (`installed: false`, whatever version rode along),
 * no component reported by this engine, or every value empty or unparseable.
 * `arch` is the machine's (`node.cores.arch`), needed only for the command;
 * `intent` is the node's stored `coreVersions`, what the row is judged against.
 */
export function coreVersionFacts(
  core: NodeCore,
  arch: CoreArch | undefined,
  intent: NodeCoreVersions = {},
): CoreVersionLine[] {
  if (core.installed === false) return [];
  const lines: CoreVersionLine[] = [];
  for (const component of componentsOfCore(core)) {
    const entry = CORE_VERSIONS[component];
    const raw = core[entry.reportedBy.field];
    const reported = typeof raw === 'string' ? raw.trim() : '';
    if (!reported) continue;
    const verdict = judgeCoreVersion(component, reported, intent);
    if (verdict.kind === 'unknown') continue;
    const target = verdict.kind === 'drift' ? verdict.intended : (intent[component] ?? entry.pinned);
    const moves = verdict.kind === 'drift' || verdict.kind === 'above-ceiling' || verdict.kind === 'known-bad';
    lines.push({
      component,
      part: PART[component] ?? null,
      reported,
      verdict,
      targetIsPin: target === entry.pinned,
      command: moves ? coreUpdateCommand(component, intent, arch) : null,
    });
  }
  return lines;
}

/**
 * The releases an operator may choose for a component, as the picker shows
 * them: each judged by the contract (a release inside a known-bad range or
 * above the ceiling is listed, marked and not choosable, with the reason).
 */
export interface CoreReleaseOption {
  version: string;
  isPin: boolean;
  blocked: { kind: 'known-bad' | 'above-ceiling'; reason: string } | null;
}

export function coreReleaseOptions(component: CoreComponent): CoreReleaseOption[] {
  const entry = CORE_VERSIONS[component];
  return entry.releases.map((r) => {
    const v = judgeCoreVersion(component, r.version);
    return {
      version: r.version,
      isPin: r.version === entry.pinned,
      blocked:
        v.kind === 'known-bad' || v.kind === 'above-ceiling' ? { kind: v.kind, reason: v.reason } : null,
    };
  });
}

/**
 * Пункты выбора версии (владелец 25.09: «пин манифеста (26.3.27)» и
 * «26.3.27 · пин» читались как дубль). Два разных намерения, и слова разные:
 *
 *   recommended  ключа нет: нода идёт за пином манифеста и сдвинется вместе
 *                с ним, когда панель обновит манифест;
 *   pin          ключ с версией: версия закреплена до решения оператора;
 *   pinCurrent   то же, у версии, которая сейчас совпадает с пином. Это не
 *                повтор первого пункта: закреплённая не сдвинется с манифестом.
 *
 * Ни «авто», ни «обновление»: нода сама ничего не обновляет, ядро меняется
 * только командой из «Ядер».
 */
export interface CoreVersionChoice {
  /** '' = без ключа (рекомендуемая). */
  value: string;
  kind: 'recommended' | 'pin' | 'pinCurrent';
  v: string;
  blocked: CoreReleaseOption['blocked'];
}

export function coreVersionChoices(component: CoreComponent): CoreVersionChoice[] {
  const options = coreReleaseOptions(component);
  const pinned = options.find((o) => o.isPin)?.version ?? '';
  return [
    { value: '', kind: 'recommended', v: pinned, blocked: null },
    ...options.map((o): CoreVersionChoice => ({
      value: o.version,
      kind: o.isPin ? 'pinCurrent' : 'pin',
      v: o.version,
      blocked: o.blocked,
    })),
  ];
}

/**
 * How the fleet stands against the pin for one component, as the profile
 * form shows it: the version is the node's, the profile only says so.
 *
 *   onPin    reports the pin;
 *   other    reports something else (drift, above the ceiling, known bad, or
 *            anything at all when the component has no pin), with what it said;
 *   silent   cannot say: the node never reported its cores, or reports this
 *            engine without a version the contract can read.
 * A node whose report lacks this engine does not run it and is not counted.
 * Judged by the contract's judgeCoreVersion with no intent (the pin), over
 * cores[].version, never node.coreVersion (that one is xray's alone).
 */
export interface CoreFleetNode {
  id: string;
  name: string;
}

export interface CoreVersionFleet {
  component: CoreComponent;
  pinned: string | null;
  unpinnedReason: string | null;
  onPin: CoreFleetNode[];
  other: (CoreFleetNode & { version: string })[];
  silent: CoreFleetNode[];
  total: number;
}

export function coreVersionFleet(
  component: CoreComponent,
  nodes: readonly Pick<Node, 'id' | 'name' | 'cores'>[],
): CoreVersionFleet {
  const entry = CORE_VERSIONS[component];
  const onPin: CoreFleetNode[] = [];
  const other: (CoreFleetNode & { version: string })[] = [];
  const silent: CoreFleetNode[] = [];
  for (const n of nodes) {
    const who = { id: n.id, name: n.name };
    const cores = n.cores?.cores;
    if (!cores || cores.length === 0) {
      silent.push(who);
      continue;
    }
    const row = cores.find(
      (c) => (c.engine ?? c.name) === entry.reportedBy.engine && c.installed !== false,
    );
    if (!row) continue;
    const raw = row[entry.reportedBy.field];
    const reported = typeof raw === 'string' ? raw.trim() : '';
    const verdict = judgeCoreVersion(component, reported);
    if (verdict.kind === 'unknown') silent.push(who);
    else if (verdict.kind === 'intended' && verdict.isPin) onPin.push(who);
    else other.push({ ...who, version: reported });
  }
  return {
    component,
    pinned: entry.pinned,
    unpinnedReason: entry.pinned === null ? (entry.unpinnedReason ?? '') : null,
    onPin,
    other,
    silent,
    total: onPin.length + other.length + silent.length,
  };
}

/**
 * The `coreVersions` a PUT sends, by the three-value rule: a component left
 * out is not touched, null puts it back on the pin, a version sets it. Only
 * what the operator changed goes: a whole map would reset every choice the
 * screen was not looking at.
 *
 * `undefined` = send nothing: nothing changed, or the server does not know
 * the field (`stored` absent from the node).
 */
export function coreVersionsPatch(
  stored: NodeCoreVersions | undefined,
  edited: NodeCoreVersions,
): Partial<Record<CoreComponent, string | null>> | undefined {
  if (stored === undefined) return undefined;
  const patch: Partial<Record<CoreComponent, string | null>> = {};
  for (const c of CORE_COMPONENTS) {
    if (stored[c] === edited[c]) continue;
    patch[c] = edited[c] ?? null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * The 400 CORE_VERSION_NOT_LISTED: the lines the server names, one per
 * component, or null when the error is anything else. The input is checked
 * first: this reads a network error, and after `as unknown` anything goes.
 */
export function coreVersionRefusal(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return null;
  const data = res.data as { error?: unknown; problems?: unknown };
  if (data.error !== 'CORE_VERSION_NOT_LISTED') return null;
  const problems = Array.isArray(data.problems) ? data.problems.filter((p): p is string => typeof p === 'string') : [];
  return problems;
}
