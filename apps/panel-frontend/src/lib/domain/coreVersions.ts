import {
  CORE_COMPONENTS,
  CORE_VERSIONS,
  coreEnvPair,
  judgeCoreVersion,
  type CoreArch,
  type CoreComponent,
  type CoreVersionVerdict,
  type NodeCoreVersions,
} from '@iceslab/shared';
import type { NodeCore } from '@/lib/domain/nodes';

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

/** Where the installer keeps the node repository (`ICESLAB_NODE_DIR`). */
export const NODE_DIR = '/opt/iceslab-node';

/**
 * Which bootstrap moves a component on the machine, or why none can.
 *
 *   script            the bootstrap; its pair of variables is `coreEnvPair`
 *                     from the contract, taken as a pair always;
 *   'skips-installed' the AmneziaWG bootstrap leaves a loaded module and
 *                     installed tools alone, so running it again moves nothing
 *                     (until the reinstall mode of phase 7.2);
 *   'unpinned'        nothing to move to (caddy-naive is built from a branch).
 */
type CoreUpdate = { script: string } | 'skips-installed' | 'unpinned';

export const CORE_UPDATE: Record<CoreComponent, CoreUpdate> = {
  xray: { script: 'bootstrap-xray.sh' },
  singbox: { script: 'bootstrap-singbox.sh' },
  hysteria: { script: 'bootstrap-hysteria.sh' },
  'amneziawg-module': 'skips-installed',
  'amneziawg-tools': 'skips-installed',
  mtg: { script: 'bootstrap-mtg.sh' },
  mita: { script: 'bootstrap-mieru.sh' },
  'caddy-naive': 'unpinned',
};

export type CoreCommand =
  | { kind: 'command'; text: string }
  | { kind: 'none'; why: 'skips-installed' | 'unpinned' | 'no-arch' | 'no-asset' };

/**
 * The ssh line that moves `component` to `target` on a machine of `arch`, or
 * why there is none.
 *
 * The pair is sent always, the pin included: the node's checkout of the
 * scripts can be older than the panel's manifest, and its own default would
 * then install something else. No arch, no command: every file and its
 * sha256 is per arch, and a guess would be refused by the script at best.
 */
export function coreUpdateCommand(
  component: CoreComponent,
  target: string | null,
  arch: CoreArch | undefined,
): CoreCommand {
  const how = CORE_UPDATE[component];
  if (typeof how === 'string') return { kind: 'none', why: how };
  const pair = coreEnvPair(component);
  const release = target === null ? undefined : CORE_VERSIONS[component].releases.find((r) => r.version === target);
  if (!pair || !release) return { kind: 'none', why: 'unpinned' };
  if (!arch) return { kind: 'none', why: 'no-arch' };
  const asset = release.assets?.[arch];
  if (!asset) return { kind: 'none', why: 'no-asset' };
  // `sudo env X=…`, not `X=… sudo`: sudo resets the environment, and the
  // variables would never reach the script. `bash`: the scripts carry no
  // executable bit.
  const [versionVar, shaVar] = pair;
  return {
    kind: 'command',
    text:
      `sudo env ${versionVar}=${release.version} ${shaVar}=${asset.sha256} ` +
      `bash ${NODE_DIR}/apps/node/scripts/${how.script} && sudo systemctl restart iceslab-node`,
  };
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
  const engine = core.engine ?? core.name;
  return CORE_COMPONENTS.filter((c) => CORE_VERSIONS[c].reportedBy.engine === engine);
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
      command: moves ? coreUpdateCommand(component, target, arch) : null,
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
