import { z } from 'zod';
import { LINK_CELLS, LINK_CONGESTIONS, LINK_UNDERLAYS } from '@iceslab/shared';

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

/**
 * The knobs of a leg, wherever a leg is chosen.
 *
 * ONE definition for the position and for the direction, because they are one
 * field: same column name, same reader in the service, same three values. Two
 * copies would be the third copy of this dictionary, and the first two already
 * drifted apart once.
 *
 * `.strict()` so a knob this build does not know is a refusal rather than a
 * silent no-op: a control that saves and changes nothing is worse than a 400.
 * Only the tuic congestion controller lives here, and only the three values the
 * ENGINE takes, measured with `sing-box check`: anything else is answered with
 * "unknown congestion control algorithm" on the node, long after the save.
 *
 * No secret is ever accepted here. Every password and salt is minted by the
 * panel and lives in the credential, and so are the keys, the inner addresses
 * and the port of an `awg` underlay's tunnel (CascadeTunnel).
 */
const LinkParamsValue = z
  .object({
    congestion: z.enum(LINK_CONGESTIONS).optional(),
    // Phase 8: what the leg rides on. Absent is `direct`, which is what every
    // leg did before the knob; `awg` raises a tunnel between the two hops and
    // runs the leg inside it (see LINK_UNDERLAYS in shared).
    underlay: z.enum(LINK_UNDERLAYS).optional(),
  })
  .strict()
  .nullish();
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
  /**
   * What the operator chose about THIS position's leg beyond the cell.
   *
   * The same field a direction has, with the same guard and the same reader:
   * only the tuic congestion controller today, and only the three values the
   * engine takes. It was promised to positions when the contract was written
   * and shipped to directions only, so the leg between two steps took the
   * default whatever the screen offered.
   *
   * ⚠ Absent is not null here either, see the rule on the direction schema
   * below: a payload that does not mention the knob is not asking to clear it.
   */
  linkParams: LinkParamsValue,
});

/**
 * ⚠ THE RULE FOR EVERY FIELD BELOW: an ABSENT key is not a value, it is the
 * absence of an edit.
 *
 * A direction is read with three states and written with two, which is where
 * this goes wrong. `linkProtocol: null` is a value with a meaning of its own
 * ("the entry's cell"), so a server that reads a missing key as null has no way
 * left to say "do not touch this", and every PUT that mentions one direction
 * silently rewrites the others.
 *
 * Measured by FRONT on 2026-09-22 against a live panel: with DE reached over
 * the entry's cell and NL over hy2, a PUT carrying a leg for DE came back as
 * DE tuic / NL null. NL had lost its leg, and its clients would have left the
 * country over a different transport, under people, with nothing in any log.
 *
 * This is the incident of 2026-07-31 in a new place: a squad save sent a list
 * the screen did not edit and wiped `profileIds`, and a subscription went dark.
 * The rule learned there is the rule here, one field narrower: what the client
 * did not mention, the server does not touch. `resolveDirections` in the
 * service is where that is applied, and it is applied BEFORE validation and
 * before the gates, so what is checked is what will be stored.
 */
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
  /**
   * May be EMPTY: v4 can express "the tag exists, the node behind it does not
   * yet". Serving skips such a direction until it has a node. The old model
   * could not express this, because a direction WAS a node.
   *
   * ⚠ And it may be ABSENT, which is a different thing: see the rule below.
   * `.default([])` used to stand here, and a default is exactly what destroys
   * the distinction, because zod fills it in before the service can tell that
   * the client said nothing. A payload that did not mention the pool would
   * arrive as an empty one and the direction would stop serving.
   */
  nodeIds: z.array(z.uuid()).optional(),
  /**
   * The cell of the LAST leg, the one that reaches this direction (phase 5).
   *
   * `null` means "the entry's cell", which is what every direction did before
   * this existed. Absent and null are the same thing here on purpose: a client
   * that omits the field is not asking for a change.
   */
  linkProtocol: LinkCellValue.nullish(),
  /**
   * What the operator chose about that leg beyond the cell.
   *
   * Only the tuic congestion controller today, and only the three values the
   * ENGINE takes: sing-box answers "unknown congestion control algorithm:
   * brutal" for anything else, so offering a fourth would be a control that
   * refuses the config on the node while the panel reports the leg saved.
   *
   * No secret is ever accepted here. The obfuscation salt and every password
   * are minted by the panel and live in the credential.
   */
  linkParams: LinkParamsValue,
  /**
   * ⚠ NEVER READ FROM A REQUEST. The port is derived from the shape of the
   * cascade (LINK_PORT_BASE + the last step) and written by the server, so a
   * client that could set it could point a leg at a port the node already uses
   * for something else. Kept in the schema and IGNORED so a client can
   * round-trip its own payload without stripping fields, exactly as `tag` is.
   */
  linkPort: z.number().int().nullish(),
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
    /**
     * Consent to an entry-protocol switch that takes profiles out of the
     * cascade (phase 6, 409 ENTRY_CHANGE_DROPS_USERS). Only `true` counts, and
     * it lives for ONE request: nothing stores it, so the next switch asks
     * again. A flag that stuck would let a later edit move people with no
     * question at all.
     */
    confirmEntryChange: z.boolean().optional(),
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
