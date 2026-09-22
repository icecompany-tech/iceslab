import { z } from 'zod';
import { LINK_CELLS } from '@iceslab/shared';

// Max hops in a single cascade. Each hop adds latency + an inter-hop link
// (UFW port LINK_PORT_BASE+i), so the chain is capped. Enforced at the schema
// edge (early 400) AND in validateCascadeHops (defensive), and mirrored in the
// frontend cascade builder (the "Add hop" button stops here). Positions are
// 0..MAX_CASCADE_HOPS-1.
export const MAX_CASCADE_HOPS = 5;

// ───── v4 limits ─────
//
// Longest path a client's traffic may take: the entry, any transits, and the
// direction it leaves through. Each step adds latency and one inter-node link,
// so it is capped. The limit covers positions AND the direction, which is why
// the positions-only bound is one lower.
export const MAX_CASCADE_PATH = 5;
/** Positions only: the direction occupies the last step of the path. */
export const MAX_CASCADE_POSITIONS = MAX_CASCADE_PATH - 1;

// A direction tag is the low byte of the uint16 route tag (the high byte is the
// route-policy ordinal), so 255 is a hard ceiling. It is also a LIFETIME
// ceiling per cascade: tags are never reused, so deleting and recreating
// directions consumes the space. Burning through it must produce a clear error,
// not a silently colliding tag.
export const MAX_DIRECTION_TAG = 255;

// Total node-to-node links a cascade may carry. With a pool of M nodes on one
// step and N on the next, that step alone costs M*N listeners, each with its
// own port and secret. The cap is on the sum across every step.
export const MAX_CASCADE_LINKS = 64;

// The full 7-core protocol set. Stored as free strings on the hop; the
// node-agent realises each entry/link cell native-first (xray entry ->
// vless/ss2022/wg links), bridges later. See docs/plan/ROADMAP.md "C. Каскады".
export const CascadeProtocol = z.enum([
  'xray',
  'hysteria',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
]);

/**
 * What a LEG may be made of, on the wire.
 *
 * ⚠ A different dictionary from `CascadeProtocol` above, which is what a node
 * serves USERS with. They meet on two words and diverge on the rest: `vless`
 * is a cell and not a protocol at all, `tuic` is both, and `hy2` is the cell
 * whose protocol is spelled `hysteria`. One column used to take either, and
 * phase 5 makes that undecidable, so the schema now takes only cells.
 *
 * `xray` is accepted for ONE release as the old engine name for the vless
 * cell: the panel's screens moved with the migration, somebody's script did
 * not. It is translated and logged in `linkCellFor`.
 */
const LinkCellValue = z.enum([...LINK_CELLS, 'xray']);
export const CascadeHopSchema = z.object({
  nodeId: z.uuid(),
  /** 0 = entry, highest = exit. Must be contiguous 0..N-1 across the cascade. */
  position: z.number().int().min(0).max(MAX_CASCADE_HOPS - 1),
  /** Client-facing protocol; only valid on the entry hop. */
  entryProtocol: CascadeProtocol.optional(),
  /** CELL to the NEXT hop; omitted on the exit hop. See LinkCellValue. */
  linkProtocol: LinkCellValue.optional(),
});

/** 'chain' = sequential entry->...->exit (default/legacy). 'balancer' = one
 *  entry that latency-balances across N parallel exits (the "auto" node): hop
 *  position 0 is the entry, every hop position >=1 is a parallel exit. */
export const CascadeMode = z.enum(['chain', 'balancer']);

// ───── v4 shape (what the redesigned screens send) ─────
//
// The panel was rebuilt around positions and directions: a position is a step
// of the path holding a POOL of interchangeable nodes, a direction is a way out
// carrying a frozen tag. The storage model behind this endpoint is still the
// older one, where a cascade is an ordered list of single-node hops.
//
// Rather than block the screens until storage catches up, this accepts the new
// shape and folds it into the old one whenever the topology is expressible
// there. Everything E1 shipped is: one entry plus one exit is a chain, one
// entry plus N exits is a balancer. What does NOT fit is rejected by name, so
// an operator learns the limit instead of watching a button stay dead:
//
//   - more than one node on a position (a pool) needs the new storage;
//   - transits combined with several directions had no representation at all
//     in the old model, which is precisely why the rewrite exists.
export const CascadePositionSchema = z.object({
  nodeIds: z.array(z.uuid()).min(1),
  position: z.number().int().min(0).max(MAX_CASCADE_HOPS - 1),
  entryProtocol: CascadeProtocol.optional(),
  linkProtocol: LinkCellValue.optional(),
});

export const CascadeDirectionSchema = z.object({
  /** Identifies a direction that ALREADY EXISTS, so it keeps its tag across an
   *  edit. Absent = a new direction, which gets the next tag from the cascade's
   *  counter. A stored direction missing from the payload is deleted and its
   *  tag burns with it, never handed to anyone else. */
  id: z.uuid().optional(),
  /** Never accepted from the client: the panel issues tags and never reuses
   *  them, because a tag travels in the user's UUID and squad ACL cuts access
   *  by it. Kept in the schema (and ignored) so a client can round-trip its own
   *  payload without stripping fields. */
  tag: z.number().int().optional(),
  countryCode: z.string().length(2).nullish(),
  /** May be EMPTY: v4 can express "the tag exists, the node behind it does
   *  not yet". Serving skips such a direction until it has a node. The old
   *  model could not express this, because a direction WAS a node. */
  nodeIds: z.array(z.uuid()).default([]),
});

const CascadeBaseFields = {
  name: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
  /** When true (default), hide the cascade's non-entry (exit/transit) nodes
   *  from the raw subscription; uncheck to also expose them as direct picks. */
  hideHopsFromSub: z.boolean().default(true),
  /** Offer the Auto line: one profile that names no direction and lets the
   *  entry pick the fastest exit. Off by default, see the schema comment. */
  autoProfile: z.boolean().default(false),
};

export const CreateCascadeSchema = z
  .object({
    ...CascadeBaseFields,
    mode: CascadeMode.default('chain'),
    hops: z.array(CascadeHopSchema).min(2).max(MAX_CASCADE_HOPS).optional(),
    positions: z.array(CascadePositionSchema).min(1).max(MAX_CASCADE_HOPS).optional(),
    directions: z.array(CascadeDirectionSchema).min(1).optional(),
  })
  .superRefine((val, ctx) => {
    const hasV4 = val.positions !== undefined || val.directions !== undefined;
    if (!hasV4 && !val.hops) {
      ctx.addIssue({ code: 'custom', message: 'hops, or positions + directions, is required', path: ['hops'] });
      return;
    }
    if (hasV4 && (val.positions === undefined || val.directions === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'positions and directions must be sent together',
        path: [val.positions === undefined ? 'positions' : 'directions'],
      });
    }
  });

export const UpdateCascadeSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    enabled: z.boolean().optional(),
    mode: CascadeMode.optional(),
    hideHopsFromSub: z.boolean().optional(),
    autoProfile: z.boolean().optional(),
    hops: z.array(CascadeHopSchema).min(2).max(MAX_CASCADE_HOPS).optional(),
    positions: z.array(CascadePositionSchema).min(1).max(MAX_CASCADE_HOPS).optional(),
    directions: z.array(CascadeDirectionSchema).min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.positions === undefined) !== (val.directions === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'positions and directions must be sent together',
        path: [val.positions === undefined ? 'positions' : 'directions'],
      });
    }
  });

export const CascadeIdParamSchema = z.object({ id: z.uuid() });

export type CascadeHopInput = z.infer<typeof CascadeHopSchema>;
export type CascadePositionInput = z.infer<typeof CascadePositionSchema>;
export type CascadeDirectionInput = z.infer<typeof CascadeDirectionSchema>;
export type CreateCascadeInput = z.infer<typeof CreateCascadeSchema>;
export type UpdateCascadeInput = z.infer<typeof UpdateCascadeSchema>;
