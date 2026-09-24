/**
 * Geo sets (phase 9): the lists a rule names with `geosite:<tag>`,
 * `geoip:<tag>` or `ext:<name>:<tag>`, kept by the panel and laid out on the
 * nodes by it. The contract is docs/plan/geo-contract.md; the push side
 * (`ApplyInboundsRequest.geo`) comes with the agent, one commit with dto.go.
 *
 * One upstream for both engines: xray reads the v2fly `.dat` as it is, and the
 * chain gets rule-set JSON the panel builds from the same file. So one tag is
 * one list of domains on the xray entry and in the chain.
 */

export const GEO_SET_KINDS = ['geosite', 'geoip'] as const;
export type GeoSetKind = (typeof GEO_SET_KINDS)[number];

/** The status of the LAST attempt to fetch, upload or check a set. */
export const GEO_SET_STATUSES = ['checking', 'verified', 'broken'] as const;
export type GeoSetStatus = (typeof GEO_SET_STATUSES)[number];

/** What the file came as. Only 'dat' until the second half of phase 9.4. */
export const GEO_SET_FORMATS = ['dat', 'rule-set-json', 'mmdb'] as const;
export type GeoSetFormat = (typeof GEO_SET_FORMATS)[number];

export type GeoSetSource =
  | { type: 'builtin'; tag: string }
  | { type: 'url'; url: string; sha256Source: 'sidecar' | 'manual'; refreshHours: number }
  | { type: 'upload'; filename: string };

/**
 * A set's name, the `<name>` of `ext:<name>:<tag>`. No dots, colons or
 * slashes: xray joins it onto the asset directory unchecked (`ext:../x` walks
 * out of it, infra/conf/router.go:391 and common/platform/others.go:18) and
 * splits the rule on `:`.
 */
export const GEO_SET_NAME = /^[a-z0-9-]{1,32}$/;

/**
 * A file name in the agent's geo directory: the built-in `geosite.dat` and
 * `geoip.dat` under the names xray looks up, an operator's set as
 * `iceslab-<name>.dat`, a rule-set of the chain as `iceslab-<name>.<tag>.json`.
 * The agent holds the same pattern (internal/geo/store.go), and
 * contract-mirror.test.ts holds the two equal. Nothing with a slash, a leading
 * dot or `..` can match.
 */
export const GEO_ASSET_NAME =
  /^(geosite\.dat|geoip\.dat|iceslab-[a-z0-9-]{1,32}\.dat|iceslab-[a-z0-9-]{1,32}\.[a-z0-9@!_-]{1,64}\.json)$/;

/** The agent's geo directory (internal/geo/store.go DefaultDir). The chain
 *  config names its rule-sets by path, so the panel has to know it. */
export const GEO_DIR_ON_NODE = '/etc/iceslab-node/geo';

/** The two built-in sets. Their names are taken: `geosite:` and `geoip:` in a
 *  rule mean them, and on a node they are `geosite.dat` and `geoip.dat`. */
export const GEO_BUILTIN_NAMES = { geosite: 'geosite', geoip: 'geoip' } as const satisfies Record<
  GeoSetKind,
  string
>;

/** One upstream release file the panel fetches for a built-in set. */
export interface GeoBuiltinRelease {
  repo: string;
  /** The release tag, which is also the set's version. */
  tag: string;
  file: string;
  /** From the release's own `<file>.sha256sum`, checked 2026-09-24. */
  sha256: string;
}

/**
 * The built-in sets, pinned like the cores (core-versions.ts): a release by
 * tag with its sha256, never `latest`, so every panel of one version lays out
 * the same lists. The pin moves with a panel release.
 *
 * domain-list-community 20260922112956 is also the source of sing-geosite's
 * release of the same name, which is what the conversion test compares with.
 */
export const GEO_BUILTIN: Record<GeoSetKind, GeoBuiltinRelease> = {
  geosite: {
    repo: 'v2fly/domain-list-community',
    tag: '20260922112956',
    file: 'dlc.dat',
    sha256: 'ccfd5caee2947964da989f6b94cc3c96f068cba198b163f3ac64def70a0addb5',
  },
  geoip: {
    repo: 'v2fly/geoip',
    tag: '202609050329',
    file: 'geoip.dat',
    sha256: '1cba1f0982cf62502fa079c66047c3d0c608196da5b3305671e68f60e917a482',
  },
};

export function geoBuiltinUrl(r: GeoBuiltinRelease): string {
  return `https://github.com/${r.repo}/releases/download/${r.tag}/${r.file}`;
}

/** Ceiling for a set's file, upload or download. */
export const GEO_FILE_MAX_BYTES = 64 * 1024 * 1024;

export interface GeoSetVersionDto {
  /** builtin: the release tag; url and upload: the first 12 hex of sha256. */
  version: string;
  /** Of the `.dat` the nodes get. */
  sha256: string;
  /** Of the file as it came (phase 9.4): what an operator compares with the
   *  file they hold. Equal to `sha256` for a `.dat`; for a rule-set JSON or a
   *  MaxMind database, `sha256` is the `.dat` it was converted into. */
  sourceSha256: string;
  sizeBytes: number;
  fetchedAt: string;
  tagCount: number;
}

export interface GeoSetDto {
  id: string;
  name: string;
  kind: GeoSetKind;
  source: GeoSetSource;
  format: GeoSetFormat;
  status: GeoSetStatus;
  checkedAt: string | null;
  /** In words, when broken. */
  error: string | null;
  /**
   * The last VERIFIED version, the one a rollout sends. null = none yet.
   * `status: 'broken'` beside a non-null current reads "the last refresh was
   * broken, the nodes still have this one".
   */
  current: GeoSetVersionDto | null;
  /** Rule entries naming the set: node policies, route policies, node DNS. */
  usedByRules: number;
  /** Nodes whose rules name the set, and how many are pinned behind current. */
  nodes: { total: number; behind: number };
  createdAt: string;
  updatedAt: string;
}

/** A tag of a set, as GET /api/geo-sets/:id/tags lists it. */
export interface GeoSetTag {
  /** Lower case; xray upper-cases what a rule says before looking it up. */
  name: string;
  /** Domains or CIDRs under it. */
  entries: number;
  /** geosite only: the attributes its domains carry, for `<tag>@<attr>`. */
  attrs?: string[];
}

/** The node DTO's `geo`: what the agent's healthcheck said lies on its disk,
 *  with when this content was first seen. null on the DTO = the node has not
 *  said (an agent older than geo, or not polled yet). */
export interface NodeGeoFact {
  version: string | null;
  files: { name: string; sha256: string; size: number }[];
  observedAt: string;
}

/** The node DTO's `geoIntended`: the files its pins and rules call for. null
 *  on the DTO = its rules name no set. */
export interface NodeGeoIntended {
  version: string;
  files: {
    name: string;
    sha256: string;
    /** Who reads the file on the node: xray a `.dat`, the chain process at a
     *  cascade entry a rule-set JSON (phase 9.3). */
    reader: 'xray' | 'chain';
    setId: string;
    setName: string;
    setVersion: string;
  }[];
}

export interface GeoSetUse {
  kind: 'node-policy' | 'route-policy' | 'node-dns';
  id: string;
  name: string;
}

export interface GeoRolloutPlan {
  version: string;
  nodes: {
    id: string;
    name: string;
    /** The version this node is pinned to now, null = none. */
    from: string | null;
    filesToSend: string[];
    restartsXray: boolean;
  }[];
  /** Rule entries naming a tag the new version does not have. Non-empty
   *  refuses the rollout (409 GEO_ROLLOUT_BREAKS). */
  breaks: { entry: string; uses: GeoSetUse[] }[];
}
