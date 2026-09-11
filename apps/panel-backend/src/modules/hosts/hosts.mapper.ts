import type { Host } from '../../generated/prisma/client.js';

/**
 * Who actually gets handed this host.
 *
 * Both numbers are DISTINCT counts, and that is the whole point. The hosts
 * screen used to derive them client-side by summing `memberCount` over every
 * squad holding the profile, so one person in two squads read as two people
 * ("2 users reach it" under a panel with a single account, found 2026-08-10).
 * The frontend cannot fix that on its own: the squad list carries counts, not
 * user ids, so there is nothing to deduplicate against.
 *
 * Squad narrowing is respected: a squad that holds the profile but hands out
 * only some of its hosts does not count towards the ones it withholds.
 */
export interface HostReach {
  /** Squads that hand this host out. */
  squads: number;
  /** People in those squads, counted once each. Excludes deleted accounts. */
  users: number;
}

export interface PublicHostDto {
  id: string;
  bindingId: string;
  remark: string;
  priority: number;
  enabled: boolean;
  addressOverride: string | null;
  portOverride: number | null;
  sniOverride: string | null;
  hostHeaderOverride: string | null;
  pathOverride: string | null;
  fingerprintOverride: string | null;
  alpn: string[];
  allowInsecure: boolean;
  securityLayer: string;
  disableForFormats: string[];
  createdAt: string;
  updatedAt: string;
  /** Only the list endpoint computes this; absent elsewhere. See HostReach. */
  reach?: HostReach;
  /**
   * When the config behind this host last changed: the newest of the host, its
   * binding and its profile.
   *
   * Not `updatedAt`. Moving the port is an edit to the BINDING and it rewrites
   * the link every subscriber holds, while the host row sits untouched, so the
   * host's own stamp would tell an operator the line is current when it is not.
   * Only the endpoints that load the relations carry it.
   */
  configChangedAt?: string;
}

export function mapHost(
  h: Host,
  reach?: HostReach,
  configChangedAt?: string,
): PublicHostDto {
  return {
    ...(reach ? { reach } : {}),
    ...(configChangedAt ? { configChangedAt } : {}),
    id: h.id,
    bindingId: h.bindingId,
    remark: h.remark,
    priority: h.priority,
    enabled: h.enabled,
    addressOverride: h.addressOverride,
    portOverride: h.portOverride,
    sniOverride: h.sniOverride,
    hostHeaderOverride: h.hostHeaderOverride,
    pathOverride: h.pathOverride,
    fingerprintOverride: h.fingerprintOverride,
    alpn: h.alpn,
    allowInsecure: h.allowInsecure,
    securityLayer: h.securityLayer,
    disableForFormats: h.disableForFormats,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}
