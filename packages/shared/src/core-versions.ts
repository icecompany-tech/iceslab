import type { EngineName } from './transport.js';

/**
 * Which version of every core a node is meant to run, in one place.
 *
 * Until this file the answer lived in six shell scripts and one Go test, each
 * holding its own copy (the xray pin twice), and the panel had no idea what any
 * of them said. So a node's reported version could be printed but never judged:
 * nothing could tell "the pin" from "drifted" from "a version we know breaks
 * cascades". This is the one list the installers, the panel and the node card
 * read from.
 *
 * What a mark means:
 *   pinned    the release a node gets when nobody says otherwise;
 *   ceiling   the highest version allowed, with why; nothing above it is
 *             offered or accepted as an intent;
 *   knownBad  version ranges measured or read to be wrong for this fleet, with
 *             why. Stronger than the ceiling: a known-bad version is bad even
 *             where no ceiling is set.
 *
 * Versions are written the way the binary REPORTS them (`xray version` says
 * 26.3.27, not v26.3.27), because that is what they are compared against; the
 * upstream tag to download sits beside it, and they are not always the same
 * string.
 */

/** Machine architectures a node can be, as the installers map `uname -m`. */
export const CORE_ARCHES = ['amd64', 'arm64', 'armv7'] as const;
export type CoreArch = (typeof CORE_ARCHES)[number];

/**
 * What gets installed on a node, one entry per thing with its own version.
 *
 * Not EngineName: AmneziaWG is one engine made of two separately versioned
 * pieces (the kernel module and the `awg` tools), and naive is an engine whose
 * binary is Caddy built with a plugin. `reportedBy` says which engine row and
 * which field carries each one's version.
 */
export const CORE_COMPONENTS = [
  'xray',
  'singbox',
  'hysteria',
  'amneziawg-module',
  'amneziawg-tools',
  'mtg',
  'mita',
  'caddy-naive',
] as const;
export type CoreComponent = (typeof CORE_COMPONENTS)[number];

/** One downloadable file of a release, with the sha256 upstream published. */
export interface CoreAsset {
  file: string;
  sha256: string;
}

/**
 * One release of a component, as much as an installer needs to fetch it and
 * refuse anything else. This is also what travels in the bootstrap payload.
 *
 * Exactly one of `assets` / `commit`: a release binary is checked by its
 * sha256, a component built from source by the commit its tag must resolve to
 * (a tag can be moved, a commit cannot).
 */
export interface CoreRelease {
  /** As the binary reports it, e.g. "26.3.27", "1.0.20260618-2". */
  version: string;
  /** The upstream tag to fetch, e.g. "v26.3.27", "app/v2.12.3". */
  tag: string;
  /** Per arch. An arch that is missing is one upstream does not ship. */
  assets?: Partial<Record<CoreArch, CoreAsset>>;
  commit?: string;
}

/** A release as the manifest keeps it: plus why it is here and when it was read. */
export interface CoreReleaseRecord extends CoreRelease {
  why: string;
  /** When the sha256 / commit above were read off upstream, YYYY-MM-DD. */
  checkedAt: string;
}

/** The highest version allowed, inclusive. */
export interface CoreCeiling {
  max: string;
  reason: string;
}

/**
 * A version range known to be wrong: `from` inclusive, `before` exclusive,
 * either end open. At least one end is set.
 */
export interface CoreKnownBad {
  from?: string;
  before?: string;
  reason: string;
}

export interface CoreVersionEntry {
  /** Which engine row on a node reports this component, and in which field. */
  reportedBy: { engine: EngineName; field: 'version' | 'toolsVersion' };
  /**
   * The version of the release a node gets by default, one of `releases`.
   * null = the repository pins nothing for this component yet, see
   * `unpinnedReason`.
   */
  pinned: string | null;
  unpinnedReason?: string;
  /** Every release an operator may choose for a node. The pin is one of them. */
  releases: CoreReleaseRecord[];
  ceiling?: CoreCeiling;
  knownBad: CoreKnownBad[];
}

const XRAY_MLKEM =
  'XTLS/REALITY 8cdf7bf (xray 26.9.8) makes the server refuse a ClientHello that does not ' +
  'offer X25519MLKEM768 ahead of X25519. Our inter-hop legs dial from sing-box, whose uTLS ' +
  '(metacubex v1.8.7) offers neither in its Firefox nor its Chrome fingerprint, so a node on ' +
  'such an xray refuses every leg a sing-box chain dials into it while every config loads ' +
  'cleanly. Read from source on 2026-09-23, no fix upstream (SagerNet/sing-box #4520).';

const AWG_GENERATION =
  'Another AmneziaWG protocol generation than the fleet runs (1.x). Moving to it is a ' +
  're-issue of every config already handed out, and clients older than 4.8.12.9 stop ' +
  'connecting: a decision about the operator\'s people, never an upgrade.';

export const CORE_VERSIONS: Record<CoreComponent, CoreVersionEntry> = {
  xray: {
    reportedBy: { engine: 'xray', field: 'version' },
    pinned: '26.3.27',
    releases: [
      {
        version: '26.3.27',
        tag: 'v26.3.27',
        assets: {
          amd64: {
            file: 'Xray-linux-64.zip',
            sha256: '23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae',
          },
          arm64: {
            file: 'Xray-linux-arm64-v8a.zip',
            sha256: '4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c',
          },
          armv7: {
            file: 'Xray-linux-arm32-v7a.zip',
            sha256: 'c7265ae13c63ca0241a037df4ef960ad37938c8a67d984cc08834b2cfdf5654b',
          },
        },
        why: 'What all four stand nodes run (read 2026-09-11) and what CI tests against.',
        checkedAt: '2026-09-23',
      },
    ],
    ceiling: { max: '26.7.28', reason: XRAY_MLKEM },
    knownBad: [{ from: '26.9.8', reason: XRAY_MLKEM }],
  },

  singbox: {
    reportedBy: { engine: 'singbox', field: 'version' },
    pinned: '1.13.14',
    releases: [
      {
        version: '1.13.14',
        tag: 'v1.13.14',
        assets: {
          amd64: {
            file: 'sing-box-1.13.14-linux-amd64.tar.gz',
            sha256: 'f48703461a15476951ac4967cdad339d986f4b8096b4eb3ff0829a500502d697',
          },
          arm64: {
            file: 'sing-box-1.13.14-linux-arm64.tar.gz',
            sha256: '4742df6a4314e8ecc41736849fca6d73b8f9e91b6e8b06ee794ff17ba180579e',
          },
          armv7: {
            file: 'sing-box-1.13.14-linux-armv7.tar.gz',
            sha256: 'e01a58d28512b1447ab6156017afdeeaa306169a95d27abc00e112599e4ae46c',
          },
        },
        why:
          'The stable line on 2026-09-21; 1.14 is in beta and drops older config forms. ' +
          'CI runs the config checks against this binary.',
        checkedAt: '2026-09-23',
      },
    ],
    knownBad: [],
  },

  hysteria: {
    reportedBy: { engine: 'hysteria', field: 'version' },
    pinned: '2.12.3',
    releases: [
      {
        version: '2.12.3',
        tag: 'app/v2.12.3',
        assets: {
          amd64: {
            file: 'hysteria-linux-amd64',
            sha256: '8c7a68a906998b747a0db87586e364f995fbfddb95693ae6e2fdb68a6e920d3e',
          },
          arm64: {
            file: 'hysteria-linux-arm64',
            sha256: 'c8dc653c3ba0a28d29a26b8fa52d2086f27c0927afddce95c09965e7174e78b0',
          },
          // Upstream calls its armv7 build "arm"; there is no hysteria-linux-armv7.
          armv7: {
            file: 'hysteria-linux-arm',
            sha256: 'cc4bc596c2db473dd7ec1bbcc3cd10e0cb60302759facd95e0be73bc8751e110',
          },
        },
        why:
          'The release the phase-6 hand-off was measured against on 2026-09-23: a socks5 ' +
          'outbound with no acl carries every user to the chain.',
        checkedAt: '2026-09-23',
      },
    ],
    knownBad: [],
  },

  'amneziawg-module': {
    reportedBy: { engine: 'amneziawg', field: 'version' },
    pinned: '1.0.20260611',
    releases: [
      {
        version: '1.0.20260611',
        tag: 'v1.0.20260611',
        commit: '2a6e1a02ac024f54a23e18f894a279b7f870b8fb',
        why: 'What ru-01 and se-01 carry (read 2026-09-21).',
        checkedAt: '2026-09-21',
      },
    ],
    knownBad: [{ from: '2', reason: AWG_GENERATION }],
  },

  'amneziawg-tools': {
    reportedBy: { engine: 'amneziawg', field: 'toolsVersion' },
    pinned: '1.0.20260618-2',
    releases: [
      {
        // The "-2" is part of the upstream TAG, not packaging: v1.0.20260618 and
        // v1.0.20260618-2 are different commits.
        version: '1.0.20260618-2',
        tag: 'v1.0.20260618-2',
        commit: '61e741780e8465a67a7d7fb6cffe14a8a15d624a',
        why: 'What ru-01 and se-01 carry (read 2026-09-21).',
        checkedAt: '2026-09-21',
      },
    ],
    knownBad: [{ from: '2', reason: AWG_GENERATION }],
  },

  mtg: {
    reportedBy: { engine: 'mtproto', field: 'version' },
    pinned: '2.2.8',
    releases: [
      {
        version: '2.2.8',
        tag: 'v2.2.8',
        assets: {
          amd64: {
            file: 'mtg-2.2.8-linux-amd64.tar.gz',
            sha256: '7ef19d079d85f4e00d4f8334ec1f3f3c8718e3d0ed1f3109ea9a8673138a2102',
          },
          arm64: {
            file: 'mtg-2.2.8-linux-arm64.tar.gz',
            sha256: '562a94dd4cafcb8f179b76cfeafb76da12747c8e230bc76235bf8746cc189644',
          },
          armv7: {
            file: 'mtg-2.2.8-linux-armv7.tar.gz',
            sha256: '494ee3794ed00201e5333b478236ce2f434b33f2d3445f227debe9fc386bbef0',
          },
        },
        why: 'The release current on 2026-09-23, when the bootstrap stopped taking latest.',
        checkedAt: '2026-09-23',
      },
    ],
    knownBad: [],
  },

  mita: {
    reportedBy: { engine: 'mieru', field: 'version' },
    pinned: '3.37.0',
    releases: [
      {
        version: '3.37.0',
        tag: 'v3.37.0',
        // Upstream ships no armv7 package.
        assets: {
          amd64: {
            file: 'mita_3.37.0_amd64.deb',
            sha256: '22248dc1568280a8b1bdaf55051a59b3d64ac1edb4ec4918e3925088f78a35de',
          },
          arm64: {
            file: 'mita_3.37.0_arm64.deb',
            sha256: 'd82a7d3c76e8dad42c2736955c5c08ad7ad8f99cafefe2ef4cd1f497ec8d3caa',
          },
        },
        why: 'The release current on 2026-09-23, when the bootstrap stopped taking latest.',
        checkedAt: '2026-09-23',
      },
    ],
    knownBad: [],
  },

  'caddy-naive': {
    reportedBy: { engine: 'naive', field: 'version' },
    pinned: null,
    unpinnedReason:
      'Built on the node by xcaddy from the @naive branch of klzgrad/forwardproxy, which ' +
      'publishes no release to pin: the version is whatever Caddy and the branch were on the ' +
      'day of the build.',
    releases: [],
    knownBad: [],
  },
};

/**
 * The variable prefix each component's bootstrap script reads, as the scripts
 * already named them (an operator who exported MIERU_VERSION last month must
 * not find it silently ignored). One table for everyone who names those
 * variables: the generated pin blocks, the agent's `core-env`
 * (componentEnv in apps/node/internal/payload/coreenv.go, held equal by
 * core-pins.test.ts), the installer and the node card's update command.
 */
export const CORE_ENV_PREFIX: Record<CoreComponent, string> = {
  xray: 'XRAY',
  singbox: 'SINGBOX',
  hysteria: 'HYSTERIA',
  'amneziawg-module': 'AWG_MODULE',
  'amneziawg-tools': 'AWG_TOOLS',
  mtg: 'MTG',
  mita: 'MIERU',
  'caddy-naive': 'CADDY_NAIVE',
};

/**
 * The two variables a script takes a chosen release by, always as a pair: a
 * release binary by `<P>_VERSION` and `<P>_SHA256` (the file for the machine's
 * arch), a core built from a commit by `<P>_TAG` and `<P>_SHA` (the commit).
 * null for a component with nothing to choose (caddy-naive).
 */
export function coreEnvPair(component: CoreComponent): [string, string] | null {
  const entry = CORE_VERSIONS[component];
  const release = entry.releases[0];
  if (!release) return null;
  const p = CORE_ENV_PREFIX[component];
  return release.commit ? [`${p}_TAG`, `${p}_SHA`] : [`${p}_VERSION`, `${p}_SHA256`];
}

/**
 * What an operator chose for one node, per component. A missing key means "the
 * pin", so a node nobody touched follows the manifest when the pin moves.
 * Every value has to be one of that component's `releases`.
 */
export type NodeCoreVersions = Partial<Record<CoreComponent, string>>;

/**
 * What the bootstrap payload carries: the release of every component the node
 * should get, resolved from its intent. The installer takes these as its
 * defaults; an explicit env on the machine still wins. A component with no pin
 * and no choice is absent, and the installer keeps its own behaviour for it.
 */
export type BootstrapCoreVersions = Partial<Record<CoreComponent, CoreRelease>>;

const VERSION_SHAPE = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.]+))?$/;

/** A reported version cleaned to the manifest's form, or null when it is not one. */
export function normalizeCoreVersion(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  const m = VERSION_SHAPE.exec(v);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1]!;
}

/**
 * Orders two versions: -1, 0, 1, or undefined when it cannot be said.
 *
 * Numbers first, segment by segment ("1.0" equals "1.0.0"). When the numbers
 * are equal and only the suffixes differ, the answer is undefined on purpose:
 * upstreams do not agree on what a suffix means (semver reads "-2" as BEFORE
 * the bare version, amneziawg-tools uses it for a re-release AFTER it), and a
 * wrong guess here would call a good version bad. Callers read undefined as
 * "cannot claim", never as either side.
 */
export function compareCoreVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  const ma = VERSION_SHAPE.exec(a.trim());
  const mb = VERSION_SHAPE.exec(b.trim());
  if (!ma || !mb) return undefined;
  const na = ma[1]!.split('.').map(Number);
  const nb = mb[1]!.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const x = na[i] ?? 0;
    const y = nb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return (ma[2] ?? '') === (mb[2] ?? '') ? 0 : undefined;
}

/** The manifest's record of one release, or undefined when it is not listed. */
export function coreReleaseOf(
  component: CoreComponent,
  version: string,
): CoreReleaseRecord | undefined {
  const v = normalizeCoreVersion(version);
  return CORE_VERSIONS[component].releases.find((r) => r.version === v);
}

/**
 * What is wrong with an intent, one line per component, or [] when nothing is.
 * A choice has to be a listed release: the manifest is where a version gets its
 * checksum, and a version without one is not installed.
 */
export function checkCoreVersionIntent(intent: NodeCoreVersions): string[] {
  const problems: string[] = [];
  for (const [key, version] of Object.entries(intent)) {
    if (!(CORE_COMPONENTS as readonly string[]).includes(key)) {
      problems.push(`${key}: not a core component`);
      continue;
    }
    const component = key as CoreComponent;
    if (version === undefined) continue;
    if (!coreReleaseOf(component, version)) {
      const listed = CORE_VERSIONS[component].releases.map((r) => r.version);
      problems.push(
        listed.length
          ? `${component}: ${version} is not a listed release (${listed.join(', ')})`
          : `${component}: nothing is listed to choose from`,
      );
    }
  }
  return problems;
}

/**
 * The release of every component for a node with this intent: its choice where
 * it made one, the pin elsewhere. Throws on an intent that fails
 * checkCoreVersionIntent, which the write path refuses first; a stored intent
 * that stopped being valid (its release was taken off the list) has to fail the
 * install loudly rather than quietly hand out the pin instead.
 */
export function resolveCoreVersions(intent: NodeCoreVersions = {}): BootstrapCoreVersions {
  const problems = checkCoreVersionIntent(intent);
  if (problems.length) throw new Error(`core version intent: ${problems.join('; ')}`);
  const out: BootstrapCoreVersions = {};
  for (const component of CORE_COMPONENTS) {
    const version = intent[component] ?? CORE_VERSIONS[component].pinned;
    if (version === null) continue;
    const r = coreReleaseOf(component, version)!;
    out[component] = {
      version: r.version,
      tag: r.tag,
      ...(r.assets ? { assets: r.assets } : {}),
      ...(r.commit ? { commit: r.commit } : {}),
    };
  }
  return out;
}

/**
 * How one reported version stands against the manifest and the node's intent.
 *
 *   unknown        nothing reported, or not something shaped like a version;
 *   known-bad      inside a knownBad range. Checked first: bad is bad even
 *                  when somebody intended it;
 *   above-ceiling  newer than the ceiling;
 *   unpinned       the repository pins nothing for this component and the
 *                  node chose nothing, so there is nothing to hold it to;
 *   intended       what the node is meant to run (`isPin`: and that is the pin);
 *   drift          something else, `intended` says what it should be.
 *
 * known-bad and above-ceiling are claimed only when the order is certain; a
 * version whose order cannot be decided falls through to drift or intended.
 */
export type CoreVersionVerdict =
  | { kind: 'unknown' }
  | { kind: 'known-bad'; reason: string }
  | { kind: 'above-ceiling'; ceiling: string; reason: string }
  | { kind: 'unpinned'; reason: string }
  | { kind: 'intended'; isPin: boolean }
  | { kind: 'drift'; intended: string };

export function judgeCoreVersion(
  component: CoreComponent,
  reported: string | null | undefined,
  intent: NodeCoreVersions = {},
): CoreVersionVerdict {
  const v = normalizeCoreVersion(reported);
  if (v === null) return { kind: 'unknown' };
  const entry = CORE_VERSIONS[component];

  for (const bad of entry.knownBad) {
    const fromOk = bad.from === undefined || isAtLeast(v, bad.from);
    const beforeOk = bad.before === undefined || compareCoreVersions(v, bad.before) === -1;
    if (fromOk && beforeOk) return { kind: 'known-bad', reason: bad.reason };
  }
  if (entry.ceiling && compareCoreVersions(v, entry.ceiling.max) === 1) {
    return { kind: 'above-ceiling', ceiling: entry.ceiling.max, reason: entry.ceiling.reason };
  }

  const intended = intent[component] ?? entry.pinned;
  if (intended === null) {
    return { kind: 'unpinned', reason: entry.unpinnedReason ?? '' };
  }
  if (compareCoreVersions(v, intended) === 0) {
    return { kind: 'intended', isPin: intended === entry.pinned };
  }
  return { kind: 'drift', intended };
}

/** Where the installer keeps the node repository (`ICESLAB_NODE_DIR`). */
export const CORE_NODE_DIR = '/opt/iceslab-node';

/** The bootstrap that puts an engine on a machine, under apps/node/scripts. */
export const ENGINE_BOOTSTRAP: Record<EngineName, string> = {
  xray: 'bootstrap-xray.sh',
  singbox: 'bootstrap-singbox.sh',
  hysteria: 'bootstrap-hysteria.sh',
  amneziawg: 'bootstrap-amneziawg.sh',
  mtproto: 'bootstrap-mtg.sh',
  mieru: 'bootstrap-mieru.sh',
  naive: 'bootstrap-naive.sh',
};

/** The components an engine reports (AmneziaWG: module and tools). */
export function componentsOfEngine(engine: string): CoreComponent[] {
  return CORE_COMPONENTS.filter((c) => CORE_VERSIONS[c].reportedBy.engine === engine);
}

/**
 * The ssh line that installs an engine on a node, at the version the node is
 * meant to run (its intent, else the pin).
 *
 *   pinned  every component of the engine goes with its pair of variables, so
 *           the node's checkout of the scripts, which can be older than the
 *           panel's manifest, cannot install something else;
 *   why     set when the pair could not be written for at least one component:
 *             no-arch   the node never reported its arch, and every file and
 *                       sha256 is per arch;
 *             no-asset  upstream ships nothing for this arch;
 *             unpinned  nothing to pin (caddy-naive is built from a branch).
 *           The command then runs the script on its own defaults.
 *
 * `sudo env X=…`, not `X=… sudo`: sudo resets the environment. `bash`: the
 * scripts carry no executable bit. `--restart-agent`: the bootstrap writes its
 * core into the agent's env and restarts the agent itself, which is what makes
 * the agent see the new core (a `&& systemctl restart` after it would be a
 * second restart).
 */
export function coreInstallCommand(
  engine: EngineName,
  intent: NodeCoreVersions = {},
  arch?: CoreArch,
): { command: string; pinned: boolean; why?: 'no-arch' | 'no-asset' | 'unpinned' } {
  const vars: string[] = [];
  let why: 'no-arch' | 'no-asset' | 'unpinned' | undefined;
  for (const component of componentsOfEngine(engine)) {
    const version = intent[component] ?? CORE_VERSIONS[component].pinned;
    const release = version === null ? undefined : coreReleaseOf(component, version);
    const pair = coreEnvPair(component);
    if (!release || !pair) {
      why ??= 'unpinned';
      continue;
    }
    if (release.commit) {
      vars.push(`${pair[0]}=${release.tag}`, `${pair[1]}=${release.commit}`);
      continue;
    }
    if (!arch) {
      why ??= 'no-arch';
      continue;
    }
    const asset = release.assets?.[arch];
    if (!asset) {
      why ??= 'no-asset';
      continue;
    }
    vars.push(`${pair[0]}=${release.version}`, `${pair[1]}=${asset.sha256}`);
  }
  const script = `bash ${CORE_NODE_DIR}/apps/node/scripts/${ENGINE_BOOTSTRAP[engine]}`;
  return {
    command: `${vars.length ? `sudo env ${vars.join(' ')} ` : 'sudo '}${script} --restart-agent`,
    pinned: why === undefined,
    ...(why ? { why } : {}),
  };
}

function isAtLeast(v: string, bound: string): boolean {
  const c = compareCoreVersions(v, bound);
  return c === 0 || c === 1;
}
