import type { NamedOutboundType } from './named-outbounds.schemas.js';

/** Where a named outbound stands: one row per cascade direction on it. */
export interface NamedOutboundUse {
  cascadeId: string;
  cascadeName: string;
  directionTag: number;
}

/**
 * A named outbound as the admin API gives it (phase 10). `config` is returned
 * whole, secrets included, the way a profile's config is (ARCH 26.09: one
 * operator's panel). Its shape per type is named-outbounds.schemas.ts.
 */
export interface PublicNamedOutbound {
  id: string;
  name: string;
  type: NamedOutboundType;
  countryCode: string | null;
  config: Record<string, unknown>;
  /** The directions standing on it; a non-empty list refuses a DELETE. */
  usedBy: NamedOutboundUse[];
  createdAt: string;
  updatedAt: string;
}

export function mapNamedOutbound(
  row: {
    id: string;
    name: string;
    type: string;
    countryCode: string | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
    directions: { tag: number; cascade: { id: string; name: string } }[];
  },
): PublicNamedOutbound {
  return {
    id: row.id,
    name: row.name,
    type: row.type as NamedOutboundType,
    countryCode: row.countryCode,
    config: (row.config ?? {}) as Record<string, unknown>,
    usedBy: row.directions
      .map((d) => ({ cascadeId: d.cascade.id, cascadeName: d.cascade.name, directionTag: d.tag }))
      .sort((a, b) => a.cascadeName.localeCompare(b.cascadeName) || a.directionTag - b.directionTag),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
