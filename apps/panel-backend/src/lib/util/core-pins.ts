import { CORE_ARCHES, CORE_VERSIONS, type CoreComponent } from '@iceslab/shared';

/**
 * The pins the node installers carry, written FROM the version manifest
 * (packages/shared/src/core-versions.ts) into a marked block of each script.
 *
 * The scripts run on a bare VPS with bash and nothing else, so they cannot read
 * the manifest; they carry a generated copy of it instead, and
 * core-pins.test.ts fails the moment a copy and the manifest disagree. To move a
 * pin: change the manifest, then run that test once with UPDATE_CORE_PINS=1.
 */

/**
 * The env prefix each component's variables go under in the scripts. Kept as
 * the scripts already named them: an operator who exported MIERU_VERSION last
 * month must not find it silently ignored.
 */
export const PIN_PREFIX: Record<CoreComponent, string> = {
  xray: 'XRAY',
  singbox: 'SINGBOX',
  hysteria: 'HYSTERIA',
  'amneziawg-module': 'AWG_MODULE',
  'amneziawg-tools': 'AWG_TOOLS',
  mtg: 'MTG',
  mita: 'MIERU',
  'caddy-naive': 'CADDY_NAIVE',
};

/** Which script carries which components' blocks, paths from the repo root. */
export const PIN_SITES: { file: string; components: CoreComponent[] }[] = [
  { file: 'scripts/install-iceslab-node.sh', components: ['hysteria'] },
  { file: 'apps/node/scripts/bootstrap-xray.sh', components: ['xray'] },
  { file: 'apps/node/scripts/bootstrap-hysteria.sh', components: ['hysteria'] },
  { file: 'apps/node/scripts/bootstrap-singbox.sh', components: ['singbox'] },
  {
    file: 'apps/node/scripts/bootstrap-amneziawg.sh',
    components: ['amneziawg-module', 'amneziawg-tools'],
  },
  { file: 'apps/node/scripts/bootstrap-mtg.sh', components: ['mtg'] },
  { file: 'apps/node/scripts/bootstrap-mieru.sh', components: ['mita'] },
];

export const blockStart = (c: CoreComponent) => `# >>> core-pins:${c} >>>`;
export const blockEnd = (c: CoreComponent) => `# <<< core-pins:${c} <<<`;

/** The block for one component, markers included, LF line endings. */
export function renderPinBlock(component: CoreComponent): string {
  const entry = CORE_VERSIONS[component];
  if (entry.pinned === null) throw new Error(`${component} has no pin to write`);
  const release = entry.releases.find((r) => r.version === entry.pinned)!;
  const p = PIN_PREFIX[component];
  const lines = [
    blockStart(component),
    '# Generated from packages/shared/src/core-versions.ts, do not edit by hand:',
    '# change the manifest, then run core-pins.test.ts with UPDATE_CORE_PINS=1.',
    `${p}_PINNED_VERSION="${release.version}"`,
    `${p}_PINNED_TAG="${release.tag}"`,
  ];
  if (release.commit) lines.push(`${p}_PINNED_COMMIT="${release.commit}"`);
  if (release.assets) {
    // Every arch appears in both maps, empty where upstream ships nothing, so a
    // lookup under `set -u` gives "" and the script can say why it stops.
    lines.push(`declare -A ${p}_PINNED_FILE=(`);
    for (const arch of CORE_ARCHES) lines.push(`  [${arch}]="${release.assets[arch]?.file ?? ''}"`);
    lines.push(')');
    lines.push(`declare -A ${p}_PINNED_SHA256=(`);
    for (const arch of CORE_ARCHES) lines.push(`  [${arch}]="${release.assets[arch]?.sha256 ?? ''}"`);
    lines.push(')');
  }
  lines.push(blockEnd(component));
  return lines.join('\n');
}

/**
 * The script with the component's block replaced by the rendered one. Throws
 * when the markers are missing or doubled: a script without its block is one
 * the manifest no longer reaches, and that has to be fixed by hand, once.
 */
export function writePinBlock(script: string, component: CoreComponent): string {
  const start = blockStart(component);
  const end = blockEnd(component);
  const from = script.indexOf(start);
  const to = script.indexOf(end);
  if (from === -1 || to === -1 || to < from) throw new Error(`no ${component} block`);
  if (script.indexOf(start, from + 1) !== -1) throw new Error(`two ${component} blocks`);
  return script.slice(0, from) + renderPinBlock(component) + script.slice(to + end.length);
}

/** The block as it stands in the script, markers included, or null. */
export function readPinBlock(script: string, component: CoreComponent): string | null {
  const from = script.indexOf(blockStart(component));
  const to = script.indexOf(blockEnd(component));
  if (from === -1 || to === -1 || to < from) return null;
  return script.slice(from, to + blockEnd(component).length);
}
