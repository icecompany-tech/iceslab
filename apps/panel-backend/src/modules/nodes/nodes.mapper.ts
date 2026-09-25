import type { Node } from '../../generated/prisma/client.js';
import type {
  DnsCfg,
  EngineName,
  NodeCoreRestarts,
  NodeCores,
  NodeCoreVersions,
  NodeGeoFact,
  NodeGeoIntended,
} from '@iceslab/shared';
import { intendedEngines, reportedEngines } from './node-engines.js';
import { readCoreVersions } from './node-core-versions.js';
import type { CascadeEngineNeed } from './node-cascade-needs.js';

// G (Zashchita / hardening) - public shape of the nodes.hardening jsonb blob.
// Mirrors HardeningInput in nodes.schemas.ts; the frontend reads this to seed
// the edit form so it must live on the public DTO.
export interface HardeningDto {
  ufwLockdown?: boolean;
  fail2ban?: boolean;
  realisticFallback?: boolean;
  sshAllowlist?: string[];
}

// Shape of the nodes.coreRestarts jsonb blob. Defined once in @iceslab/shared
// (NodeCoreRestarts) and re-exported here for the modules that already import
// node DTO types from this file; panel-frontend imports the same type straight
// from shared, so there is a single definition to keep in sync.
//
// ⚠ `null` on the node DTO means "no reporting agent has checked in", NOT
// "zero restarts". Older agents never send this.
export type { NodeCoreRestarts } from '@iceslab/shared';
import type { ChainStatus } from '@iceslab/shared';

export interface PublicNodeDto {
  id: string;
  name: string;
  address: string;
  /**
   * A label, derived from `intendedEngines` on every write (25.09): xray when
   * the node has it, else the first of its cores by ENGINE_NAMES, `none` for a
   * node with no core (only the agent; readers must take it). Not chosen,
   * not a capability, and not taken back on create or update (except a create
   * in the old form, which names no set). Kept for old screens and filters.
   */
  protocol: string;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  /** See NodeCoreRestarts. null = never reported (not the same as zero). */
  coreRestarts: NodeCoreRestarts | null;
  // T7: proxy-core version reported by the agent (e.g. xray "26.3.27"), NULL
  // until a versioned agent checks in. Shown on the node card; the cascade form
  // uses it to warn before selecting an old node as a balancer entry.
  coreVersion: string | null;
  /** When this node last ACKNOWLEDGED an inbound push (applyInbounds returned
   *  ok). Never stamped on a failure and never on a plain liveness tick, so it
   *  is the one field that answers "did the save land here". Deliberately not
   *  `lastStatusChange`, which only moves on an online/offline transition and
   *  therefore never moves on a healthy node.
   *
   *  The raw stamp, not a boolean: "applied" is only meaningful against the
   *  moment the config last CHANGED, and for a node that moment is spread
   *  across its bindings, profiles, hosts and cascades. Computing it per row
   *  would put five aggregates behind every list page, so the comparison lives
   *  in GET /api/nodes/:id/sync-status instead. */
  lastInboundSyncAt: string | null;
  /**
   * Why the last push did NOT land, in the core's own words.
   *
   * null = the last push succeeded, or none was ever tried; the stamp above
   * tells those two apart. The pair is written together, so a fresh stamp
   * never sits next to a stale reason.
   *
   * `message` is the whole refusal as it travelled, agent prefix included: the
   * part before "core rejected the config" names WHICH inbound of the several
   * on this node was refused, and an operator needs that as much as the core's
   * sentence. Bounded at 2000 characters, because it is another program's
   * output and not ours.
   */
  lastInboundSyncError: { at: string; message: string } | null;
  /**
   * The chain process this node reported, or null when it reported none.
   *
   * null is the ordinary state, not a fault: it is what every node says until
   * the panel starts sending a chain block, and what a node outside every
   * cascade says forever. Read it with `chainSentAt` below, which is the only
   * thing that makes a missing chain mean anything.
   */
  chainStatus: ChainStatus | null;
  /**
   * When the panel last sent this node a chain block, or null if never.
   *
   * The other half of the pair: what WE did, beside what the NODE said. A node
   * with no chain and no `chainSentAt` is normal; the same node with a
   * `chainSentAt` and no chain is a process that should be running and is not.
   */
  chainSentAt: string | null;
  consumptionMultiplier: string;
  // Slice 27.5: region grouping + capacity hint.
  regionId: string | null;
  maxUsers: number | null;
  // B3/G: FQDN for REALITY self-steal serverName + future ACME.
  domain: string | null;
  // G - probe-resistance toggles (Zashchita wizard). NULL = no hardening.
  hardening: HardeningDto | null;
  // WARP egress on/off (per-node). Creds (secretKey/token) are never exposed.
  warpEnabled: boolean;
  // Engine-choice: sing-box engine installed alongside the native core. Read
  // off intendedEngines ("singbox" in the list); kept for the older screens.
  singboxEngine: boolean;
  /**
   * Which engines the node is SET UP to carry (core-lifecycle.md section 7), a
   * set in the order of ENGINE_NAMES: no engine of it is the main one (25.09).
   * `protocol` above is a label derived from it. An intent: the installer and
   * the node card read it, no gate does. Not `engines` below, which is what
   * the node REPORTED.
   */
  intendedEngines: EngineName[];
  /** Э3: node-level routing policy this node runs, null = none. The rules
   *  themselves come from /api/node-policies; the node carries only which one. */
  policyId: string | null;
  /** Э3 F: the resolver this node's users get, null = the host's own. Shape is
   *  DnsCfg in packages/shared. */
  dns: DnsCfg | null;
  /**
   * The cores this node reported, and for each one whether it carries out the
   * node-level policy and resolver.
   *
   * Read it before telling an operator what a node does with traffic: today one
   * core of nine renders the policy, so on a node whose cores do not, an
   * attached policy does nothing. Per core, because a node serving xray
   * alongside tuic on sing-box applies it to the first and not to the second.
   *
   * ⚠ null = no reporting agent has checked in, NOT "no cores". A core with
   * `rendersPolicy` absent is an agent older than the field: unknown, not false.
   */
  cores: NodeCores | null;
  /**
   * Which core versions the operator WANTS here, the other half of `cores`.
   * Always present; a missing component is the manifest's pin, so `{}` is a
   * node that follows the manifest. Judge a report with
   * judgeCoreVersion(component, reported, coreVersions).
   */
  coreVersions: NodeCoreVersions;
  /**
   * The distinct engines those cores run, which is the question almost every
   * caller actually has ("can this node render that profile").
   *
   * ⚠ ABSENT means the node has never reported. An EMPTY array means it did
   * report and runs nothing. The absence is the signal, deliberately without a
   * boolean beside it: a flag saying "this is fact" could contradict the list,
   * and it adds no fourth state. Same idiom as `cores: null` and an absent
   * `rendersPolicy`.
   */
  engines?: EngineName[];
  /**
   * The cascade that keeps this node out of every subscription, or null: it is
   * a transit or an exit of an enabled cascade that hides its hops. A host put
   * on such a node is served to nobody, and the deploy window says so before
   * the host exists. Computed by the same function the subscription filters
   * with (getHiddenCascadeNodes), so the two cannot disagree. Present on the
   * list and on GET by id; other responses leave it out.
   */
  hiddenByCascade?: { cascadeId: string; cascadeName: string } | null;
  /**
   * The cores the cascades this node stands in need from it, and which
   * cascades (disabled ones included, `enabled: false`). Empty outside every
   * cascade. One of the two facts that keep a core from being removed, beside
   * `neededBy` on the core row (a node may end with no core, 25.09).
   * Present on the list and on GET by id.
   */
  cascadeNeedsEngines?: CascadeEngineNeed[];
  /**
   * Phase 9.2: what the agent says lies in its geo directory. null = it has
   * not said (an agent older than geo, or not polled yet), which the card
   * shows as "the node did not report" and never as "behind".
   */
  geo: NodeGeoFact | null;
  /**
   * The files the node's pins and rules call for; null = its rules name no
   * set. The card compares them with `geo` file by file, by sha256. Present
   * on the list and on GET by id.
   */
  geoIntended?: NodeGeoIntended | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The keys of the node DTO a screen cannot take for granted, named by the
 * server that renders them. Served as `fields` beside the list (GET
 * /api/nodes), so the answer does not depend on having a node: E29, 24.09, an
 * empty fleet read as "this server knows none of them" and the first node of a
 * fresh panel went out on the old form without --engines.
 *
 * Two kinds. Keys that are optional on the DTO, where absence is itself a
 * state (`engines` absent = never reported); with the name listed, absence
 * means that state and not an older server. And keys an older server did not
 * render at all (`intendedEngines`, `coreVersions`). A key inside the per-core
 * rows is spelled as its path, `cores[].reason`.
 *
 * Only what this server renders: `awgProtocol` is not here, because nothing on
 * this side writes or reads it yet. nodes.fields.test.ts holds the list to the
 * DTO both ways.
 */
export const NODE_DTO_FIELDS = [
  'intendedEngines',
  'coreVersions',
  'engines',
  'hiddenByCascade',
  'cascadeNeedsEngines',
  'cores[].reason',
  'geo',
  'geoIntended',
] as const;

/**
 * Public DTO for a node, strips internal cert/key material and lifecycle
 * fields (deletedAt, publicKey blob).
 */
export function mapNodeToPublic(node: Node): PublicNodeDto {
  const engines = reportedEngines(node);
  const intended = intendedEngines(node);
  return {
    id: node.id,
    name: node.name,
    address: node.address,
    protocol: node.protocol,
    countryCode: node.countryCode,
    status: node.status,
    lastStatusChange: node.lastStatusChange?.toISOString() ?? null,
    lastStatusMessage: node.lastStatusMessage,
    coreRestarts: (node.coreRestarts as NodeCoreRestarts | null) ?? null,
    coreVersion: node.coreVersion,
    lastInboundSyncAt: node.lastInboundSyncAt?.toISOString() ?? null,
    lastInboundSyncError:
      (node.lastInboundSyncError as { at: string; message: string } | null) ?? null,
    chainStatus: (node.chainStatus as ChainStatus | null) ?? null,
    chainSentAt: node.chainSentAt?.toISOString() ?? null,
    consumptionMultiplier: node.consumptionMultiplier.toString(),
    regionId: node.regionId,
    maxUsers: node.maxUsers,
    domain: node.domain,
    hardening: (node.hardening as HardeningDto | null) ?? null,
    warpEnabled: node.warpEnabled,
    singboxEngine: intended.includes('singbox'),
    intendedEngines: intended,
    policyId: node.policyId,
    dns: (node.dns as DnsCfg | null) ?? null,
    cores: (node.cores as NodeCores | null) ?? null,
    coreVersions: readCoreVersions(node.coreVersions),
    ...(engines !== undefined ? { engines } : {}),
    geo: (node.geo as NodeGeoFact | null) ?? null,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}

export interface BootstrapInfo {
  /** Short single-use token (URL-safe). Survives 4 KB TTY paste limit. */
  token: string;
  /** ISO timestamp when the token stops being redeemable. */
  expiresAt: string;
  /** Pre-rendered single-line install command, ready for copy-paste. */
  command: string;
}

export interface CreateNodeResponseDto extends PublicNodeDto {
  /**
   * Base64url-encoded one-time payload containing the node's mTLS cert+key
   * and the panel CA. Kept for the manual / air-gapped flow (Download +
   * scp + `--payload-file`), most admins should use the bootstrap-token
   * flow below instead.
   */
  payload: string;
  /**
   * Bootstrap info for the network-fetch flow: admin pastes a short
   * command on the node, the install-script curls the panel for the full
   * payload over HTTP. No 4096-byte TTY paste limit, single command.
   */
  bootstrap: BootstrapInfo;
}

export function mapNodeWithPayload(
  node: Node,
  payload: string,
  bootstrap: BootstrapInfo,
): CreateNodeResponseDto {
  return { ...mapNodeToPublic(node), payload, bootstrap };
}
