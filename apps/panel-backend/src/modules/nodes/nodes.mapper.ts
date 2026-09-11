import type { Node } from '../../generated/prisma/client.js';
import type { NodeCoreRestarts } from '@iceslab/shared';

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

export interface PublicNodeDto {
  id: string;
  name: string;
  address: string;
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
  // Engine-choice: sing-box engine installed alongside the native core.
  singboxEngine: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public DTO for a node, strips internal cert/key material and lifecycle
 * fields (deletedAt, publicKey blob).
 */
export function mapNodeToPublic(node: Node): PublicNodeDto {
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
    consumptionMultiplier: node.consumptionMultiplier.toString(),
    regionId: node.regionId,
    maxUsers: node.maxUsers,
    domain: node.domain,
    hardening: (node.hardening as HardeningDto | null) ?? null,
    warpEnabled: node.warpEnabled,
    singboxEngine: node.singboxEngine,
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
