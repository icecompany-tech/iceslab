import {
  CORE_COMPONENTS,
  CORE_VERSIONS,
  judgeCoreVersion,
  type CoreArch,
  type CoreComponent,
  type CoreVersionVerdict,
} from '@iceslab/shared';
import type { NodeCore } from '@/lib/domain/nodes';

/**
 * A core row against the version manifest (packages/shared/core-versions.ts).
 *
 * The judge is `judgeCoreVersion` from the contract and nothing else: the
 * screen compares no versions of its own (contractCopies guards the names).
 * What lives here is only what the screen adds: which components a row
 * carries, and how a person moves one on the machine.
 *
 * No intent is passed until Node.coreVersions exists (step в): a missing
 * intent IS the pin, by the manifest's own rule.
 */

/** Where the installer keeps the node repository (`ICESLAB_NODE_DIR`). */
export const NODE_DIR = '/opt/iceslab-node';

/**
 * How one component is moved on the machine, or why a command cannot be given.
 *
 *   script / prefix  the bootstrap that installs it and the prefix of its pair
 *                    of variables, <P>_VERSION and <P>_SHA256. Every bootstrap
 *                    takes a version only together with its checksum and strips
 *                    a leading "v" itself, so the release's version goes as it
 *                    is, one form for all;
 *   'skips-installed' the AmneziaWG bootstrap leaves a loaded module and
 *                    installed tools alone, so running it again moves nothing
 *                    (until the reinstall mode of phase 7.2);
 *   'unpinned'       nothing to move to (caddy-naive is built from a branch).
 */
type CoreUpdate = { script: string; prefix: string } | 'skips-installed' | 'unpinned';

export const CORE_UPDATE: Record<CoreComponent, CoreUpdate> = {
  xray: { script: 'bootstrap-xray.sh', prefix: 'XRAY' },
  singbox: { script: 'bootstrap-singbox.sh', prefix: 'SINGBOX' },
  hysteria: { script: 'bootstrap-hysteria.sh', prefix: 'HYSTERIA' },
  'amneziawg-module': 'skips-installed',
  'amneziawg-tools': 'skips-installed',
  mtg: { script: 'bootstrap-mtg.sh', prefix: 'MTG' },
  mita: { script: 'bootstrap-mieru.sh', prefix: 'MIERU' },
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
  const release = target === null ? undefined : CORE_VERSIONS[component].releases.find((r) => r.version === target);
  if (!release) return { kind: 'none', why: 'unpinned' };
  if (!arch) return { kind: 'none', why: 'no-arch' };
  const asset = release.assets?.[arch];
  if (!asset) return { kind: 'none', why: 'no-asset' };
  // `sudo env X=…`, not `X=… sudo`: sudo resets the environment, and the
  // variables would never reach the script. `bash`: the scripts carry no
  // executable bit.
  const p = how.prefix;
  return {
    kind: 'command',
    text:
      `sudo env ${p}_VERSION=${release.version} ${p}_SHA256=${asset.sha256} ` +
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
  /** Only where the verdict asks for a move (drift, above the ceiling, known bad). */
  command: CoreCommand | null;
}

const PART: Partial<Record<CoreComponent, 'module' | 'tools'>> = {
  'amneziawg-module': 'module',
  'amneziawg-tools': 'tools',
};

/**
 * What a core row says about its version(s). Empty when there is nothing to
 * judge: a missing binary (`installed: false`, whatever version rode along),
 * no component reported by this engine, or every value empty or unparseable.
 * `arch` is the machine's (`node.cores.arch`), needed only for the command.
 */
export function coreVersionFacts(core: NodeCore, arch: CoreArch | undefined): CoreVersionLine[] {
  if (core.installed === false) return [];
  const engine = core.engine ?? core.name;
  const lines: CoreVersionLine[] = [];
  for (const component of CORE_COMPONENTS) {
    const entry = CORE_VERSIONS[component];
    if (entry.reportedBy.engine !== engine) continue;
    const raw = core[entry.reportedBy.field];
    const reported = typeof raw === 'string' ? raw.trim() : '';
    if (!reported) continue;
    const verdict = judgeCoreVersion(component, reported);
    if (verdict.kind === 'unknown') continue;
    const target = verdict.kind === 'drift' ? verdict.intended : entry.pinned;
    const moves = verdict.kind === 'drift' || verdict.kind === 'above-ceiling' || verdict.kind === 'known-bad';
    lines.push({
      component,
      part: PART[component] ?? null,
      reported,
      verdict,
      command: moves ? coreUpdateCommand(component, target, arch) : null,
    });
  }
  return lines;
}
