export interface CascadeHopDto {
  id: string;
  nodeId: string;
  nodeName: string;
  position: number;
  entryProtocol: string | null;
  linkProtocol: string | null;
}

export interface CascadeDto {
  id: string;
  name: string;
  enabled: boolean;
  /** 'chain' (sequential) or 'balancer' (one entry, N latency-balanced exits). */
  mode: string;
  /** Hide the cascade's non-entry nodes from the raw subscription (default). */
  hideHopsFromSub: boolean;
  hops: CascadeHopDto[];
  createdAt: string;
  updatedAt: string;
}

interface CascadeRow {
  id: string;
  name: string;
  enabled: boolean;
  mode: string;
  hideHopsFromSub: boolean;
  createdAt: Date;
  updatedAt: Date;
  hops: {
    id: string;
    nodeId: string;
    position: number;
    entryProtocol: string | null;
    linkProtocol: string | null;
    node: { id: string; name: string } | null;
  }[];
}

export function mapCascade(c: CascadeRow): CascadeDto {
  return {
    id: c.id,
    name: c.name,
    enabled: c.enabled,
    mode: c.mode,
    hideHopsFromSub: c.hideHopsFromSub,
    hops: c.hops.map((h) => ({
      id: h.id,
      nodeId: h.nodeId,
      nodeName: h.node?.name ?? '',
      position: h.position,
      entryProtocol: h.entryProtocol,
      linkProtocol: h.linkProtocol,
    })),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
