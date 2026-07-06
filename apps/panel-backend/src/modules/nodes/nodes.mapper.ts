import type { Node } from '../../generated/prisma/client.js';

// G (Zashchita / hardening) - public shape of the nodes.hardening jsonb blob.
// Mirrors HardeningInput in nodes.schemas.ts; the frontend reads this to seed
// the edit form so it must live on the public DTO.
export interface HardeningDto {
  ufwLockdown?: boolean;
  fail2ban?: boolean;
  realisticFallback?: boolean;
  sshAllowlist?: string[];
}

export interface PublicNodeDto {
  id: string;
  name: string;
  address: string;
  protocol: string;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
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
