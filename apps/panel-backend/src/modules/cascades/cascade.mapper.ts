import { storedLinkParams } from './direction-merge.js';

export interface CascadeHopDto {
  id: string;
  nodeId: string;
  nodeName: string;
  position: number;
  entryProtocol: string | null;
  linkProtocol: string | null;
}

/** One step of the path, holding a POOL of interchangeable nodes. */
export interface CascadePositionDto {
  /** 0 = entry, then transits in order. */
  position: number;
  nodeIds: string[];
  entryProtocol: string | null;
  linkProtocol: string | null;
  /**
   * What the operator chose about the leg OUT of this position, beyond the
   * cell: the congestion controller of a tuic leg, and nothing else today.
   *
   * Always present, like the direction's three keys and for the same reason: a
   * screen tells "no value" from "the server does not send this field", and the
   * second reading would hide the control for good. `null` is the defaults.
   */
  linkParams: { congestion?: string } | null;
}

/**
 * A way out of the cascade.
 *
 * ⚠ `id` matters on save: send it back for a direction that already exists and
 * it keeps its `tag`. A direction saved without its id is treated as new and
 * draws a fresh tag, which changes the link every client holding that direction
 * uses - i.e. it silently moves people to a different country. The pool is used
 * as a fallback match, but it stops working the moment the pool itself changes.
 */
export interface CascadeDirectionDto {
  id: string;
  /** Frozen identity of this direction; travels in the client's UUID. Never
   *  accepted as input, only reported. */
  tag: number;
  countryCode: string | null;
  /** May be empty: a direction can exist with its tag reserved and no node
   *  behind it yet. Such a direction is simply not served. */
  nodeIds: string[];
  /**
   * The cell of the LAST leg, the one reaching this direction (phase 5).
   *
   * `null` is a VALUE and means "the entry's cell", which is what every
   * direction did before the field existed. The screen tells that apart from
   * "the server does not send this field at all", which is why all three keys
   * below are always present: a missing key is how a screen decides the
   * feature has not shipped, and it would decide that forever.
   */
  linkProtocol: string | null;
  /** What the operator chose about that leg beyond the cell: the congestion
   *  controller of a tuic leg, and nothing else today. Never a secret. */
  linkParams: { congestion?: string } | null;
  /**
   * The port the receiving side of that leg listens on.
   *
   * Read-only, and the DTO is the only place it is ever seen: the server
   * derives it from the shape of the cascade and ignores whatever a request
   * carries. `null` until the cascade has been saved once.
   */
  linkPort: number | null;
}

export interface CascadeDto {
  id: string;
  name: string;
  enabled: boolean;
  /** 'chain' (sequential) or 'balancer' (one entry, N latency-balanced exits). */
  mode: string;
  /** Hide the cascade's non-entry nodes from the raw subscription (default). */
  hideHopsFromSub: boolean;
  /** Offer the Auto line in the subscription: one profile that names no
   *  direction and lets the entry pick the fastest exit by measured RTT. */
  autoProfile: boolean;
  hops: CascadeHopDto[];
  /** v4 shape. Always present (possibly empty): empty means the cascade was
   *  written before the topology tables existed and still describes itself
   *  through `hops`. */
  positions: CascadePositionDto[];
  directions: CascadeDirectionDto[];
  /** Tag the NEXT new direction will receive. Reported because the panel shows
   *  it before saving and cannot derive it: tags are never reused, so after a
   *  delete `max(tag) + 1` guesses wrong (delete 5, add one, the server issues
   *  6 while the form promises 5). */
  nextDirectionTag: number;
  createdAt: string;
  updatedAt: string;
}

interface CascadeRow {
  id: string;
  name: string;
  enabled: boolean;
  mode: string;
  hideHopsFromSub: boolean;
  /** Optional so a caller selecting a narrow row shape still type-checks; a
   *  missing value reads as off, which is the default. */
  autoProfile?: boolean;
  nextDirectionTag?: number;
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
  positions?: {
    position: number;
    entryProtocol: string | null;
    linkProtocol: string | null;
    /** Whatever jsonb holds; read, not trusted. Optional on the ROW so a narrow
     *  select still type-checks, while the DTO key stays mandatory. */
    linkParams?: unknown;
    nodes: { nodeId: string }[];
  }[];
  directions?: {
    id: string;
    tag: number;
    countryCode: string | null;
    /** Optional on the ROW for the same reason as `autoProfile`: a caller that
     *  selects a narrow shape still type-checks. The DTO keys stay mandatory. */
    linkProtocol?: string | null;
    /** Whatever jsonb holds. Read, not trusted: see `legParams`. */
    linkParams?: unknown;
    linkPort?: number | null;
    nodes: { nodeId: string }[];
  }[];
}

/**
 * The leg knobs of a direction, read by the one reader of that column.
 *
 * It had its own copy here, which differed in one way that matters: it accepted
 * ANY string as a controller, while the merge that writes the value back
 * accepts only the three the engine takes. So a hand-edited row travelled to
 * the screen, the screen sent it back, and the save dropped it: a control that
 * changed by itself between two saves nobody made.
 */
const legParams = storedLinkParams;

export function mapCascade(c: CascadeRow): CascadeDto {
  return {
    id: c.id,
    name: c.name,
    enabled: c.enabled,
    mode: c.mode,
    hideHopsFromSub: c.hideHopsFromSub,
    autoProfile: c.autoProfile ?? false,
    hops: c.hops.map((h) => ({
      id: h.id,
      nodeId: h.nodeId,
      nodeName: h.node?.name ?? '',
      position: h.position,
      entryProtocol: h.entryProtocol,
      linkProtocol: h.linkProtocol,
    })),
    positions: (c.positions ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        position: p.position,
        nodeIds: p.nodes.map((n) => n.nodeId),
        entryProtocol: p.entryProtocol,
        linkProtocol: p.linkProtocol,
        linkParams: legParams(p.linkParams),
      })),
    directions: (c.directions ?? [])
      .slice()
      .sort((a, b) => a.tag - b.tag)
      .map((d) => ({
        id: d.id,
        tag: d.tag,
        countryCode: d.countryCode,
        nodeIds: d.nodes.map((n) => n.nodeId),
        // `?? null` and not `?.`: a row selected without these columns must
        // answer the same three keys as a row that has them and holds nothing,
        // because the screen distinguishes "no value" from "no such field" and
        // would otherwise read a narrow select as a feature that never shipped.
        linkProtocol: d.linkProtocol ?? null,
        linkParams: legParams(d.linkParams),
        linkPort: d.linkPort ?? null,
      })),
    nextDirectionTag: c.nextDirectionTag ?? 1,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
