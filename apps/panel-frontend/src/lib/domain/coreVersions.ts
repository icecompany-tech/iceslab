import {
  CORE_COMPONENTS,
  CORE_VERSIONS,
  judgeCoreVersion,
  type CoreComponent,
  type CoreRelease,
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
 *   script / env   the bootstrap that installs it and the variable that picks
 *                  the release; `value` turns a release into what the variable
 *                  wants, because the scripts do not agree (sing-box takes the
 *                  tag, hysteria takes "v" + version: its tag "app/v2.12.3"
 *                  would break the download URL);
 *   env null       the script takes a version only together with a per-arch
 *                  sha256 (mtg, mita), so the command can name only the
 *                  script's own pin, which is the manifest's pin;
 *   'no-script'    xray has no bootstrap of its own: it comes with the main
 *                  installer, and re-running that wipes the node's mTLS keys;
 *   'skips-installed' the AmneziaWG bootstrap leaves a loaded module and
 *                  installed tools alone, so running it again moves nothing;
 *   'unpinned'     nothing to move to (caddy-naive is built from a branch).
 */
type CoreUpdate =
  | { script: string; env: { name: string; value: (r: CoreRelease) => string } | null }
  | 'no-script'
  | 'skips-installed'
  | 'unpinned';

export const CORE_UPDATE: Record<CoreComponent, CoreUpdate> = {
  xray: 'no-script',
  singbox: { script: 'bootstrap-singbox.sh', env: { name: 'SINGBOX_VERSION', value: (r) => r.tag } },
  hysteria: { script: 'bootstrap-hysteria.sh', env: { name: 'HYSTERIA_VERSION', value: (r) => `v${r.version}` } },
  'amneziawg-module': 'skips-installed',
  'amneziawg-tools': 'skips-installed',
  mtg: { script: 'bootstrap-mtg.sh', env: null },
  mita: { script: 'bootstrap-mieru.sh', env: null },
  'caddy-naive': 'unpinned',
};

export type CoreCommand =
  | { kind: 'command'; text: string }
  | { kind: 'none'; why: 'no-script' | 'skips-installed' | 'unpinned' | 'needs-checksum' };

/** The ssh line that moves `component` to `target`, or why there is none. */
export function coreUpdateCommand(component: CoreComponent, target: string | null): CoreCommand {
  const how = CORE_UPDATE[component];
  if (typeof how === 'string') return { kind: 'none', why: how };
  const release = target === null ? undefined : CORE_VERSIONS[component].releases.find((r) => r.version === target);
  if (!release) return { kind: 'none', why: 'unpinned' };
  if (how.env === null && release.version !== CORE_VERSIONS[component].pinned) {
    return { kind: 'none', why: 'needs-checksum' };
  }
  // `sudo env X=…`, not `X=… sudo`: sudo resets the environment, and the
  // variable would never reach the script.
  const env = how.env ? `env ${how.env.name}=${how.env.value(release)} ` : '';
  return {
    kind: 'command',
    text: `sudo ${env}${NODE_DIR}/apps/node/scripts/${how.script} && sudo systemctl restart iceslab-node`,
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
 */
export function coreVersionFacts(core: NodeCore): CoreVersionLine[] {
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
      command: moves ? coreUpdateCommand(component, target) : null,
    });
  }
  return lines;
}
