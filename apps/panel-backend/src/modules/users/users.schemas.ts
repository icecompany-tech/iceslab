import { z } from 'zod';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { PermissiveUuid } from '../../lib/util/uuid-schema.js';

// ───── Reusable atoms ─────

export const TrafficLimitStrategy = z.enum(['no_reset', 'day', 'week', 'month', 'rolling']);

export const UserStatus = z.enum(['active', 'disabled', 'expired', 'limited']);

export const ProtocolName = z.enum([
  'hysteria',
  'xray',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
]);
export type ProtocolNameT = z.infer<typeof ProtocolName>;

const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(64, 'Username too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can contain only letters, digits, underscore, and hyphen');

// ───── POST /api/users ─────

export const CreateUserSchema = z.object({
  username: UsernameSchema,
  // Migration cut-over: import an existing subscription token so a migrating
  // operator's clients keep their current link instead of re-importing. URL-safe
  // (base64url alphabet), <=64 to match the column. Omit to mint a fresh token.
  subscriptionToken: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Subscription token must be URL-safe (A-Z a-z 0-9 _ -)')
    .optional(),
  trafficLimitGb: z.number().int().positive().nullish(),         // null/undefined = unlimited
  trafficLimitStrategy: TrafficLimitStrategy.default('no_reset'),
  expireDays: z.number().int().positive().nullish(),             // null/undefined = no expiry
  // ───── Import fields ─────
  //
  // A migration needs to state a user's EXISTING values, not derive fresh ones.
  // Without these the importer has to create a user and immediately PUT it,
  // which doubles the call count (13608 instead of 6804 on the deal in
  // progress) and still cannot carry credentials, so every client would have to
  // re-import their config by hand.
  //
  // All optional: a normal create ignores them entirely and behaves as before.
  //
  // expireAt wins over expireDays when both are sent: an absolute instant is a
  // fact being transferred, a relative span is a convenience for humans.
  expireAt: z.iso.datetime().nullish(),
  // Carry the user's existing VLESS identity so their current link keeps
  // working. The tag bytes inside it are rewritten by the panel on route
  // selection, so what matters is the rest of the value.
  vlessUuid: z.uuid().optional(),
  // Registration date from the source panel. Purely informational, but an
  // operator reading "registered today" for a three-year customer loses trust
  // in every other number on the page.
  createdAt: z.iso.datetime().optional(),
  // Provenance, see the sourceId column. Set by the importer, never by a human;
  // it is what makes a second run a delta instead of a duplicate.
  sourceId: z.string().max(128).optional(),
  hwidDeviceLimit: z.number().int().positive().nullish(),
  description: z.string().max(1000).nullish(),
  tag: z.string().max(64).nullish(),
  telegramId: z.union([
    z.number().int(),
    z.string().regex(/^\d+$/),
  ]).nullish(),
  email: z.email().max(255).nullish(),
  groupIds: z.array(PermissiveUuid).default([]),
  // R3 - optional per-user routing-preset override. Null = inherit (squad ->
  // global -> default). Wins over squad/global, loses only to ?routing= query.
  routingPreset: z.enum(ROUTING_PRESET_IDS).nullable().optional(),
  // Slice 27 follow-up: enabledProtocols accepted for back-compat with API
  // clients but no longer affects subscription output. Squad ACL alone
  // determines visibility. Empty/missing → defaults to all 7 (was previously
  // ['hysteria'] which silently hid newer protocols from new users).
  enabledProtocols: z
    .array(ProtocolName)
    .default(['hysteria', 'xray', 'amneziawg', 'naive', 'shadowsocks', 'mtproto', 'mieru']),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// ───── POST /api/users/bulk ─────
//
// One billing cycle of a reseller touches hundreds of users at once (extend the
// paid ones, reset counters on the strategy date, revoke the lapsed). Doing
// that one HTTP call at a time turns a routine job into thousands of requests
// and leaves the operator with no idea which of them failed.

/** Cap per request. Not a performance limit - the work is the same either way -
 *  but a bound on the blast radius of one mistaken call, and on how long a
 *  single request holds a connection. Larger jobs page. */
export const MAX_BULK_USERS = 500;

export const BulkUserActionSchema = z.enum([
  'extend',        // push expiry out by `expireDays`
  'reset-traffic', // zero the counter, same path as the cron strategy reset
  'revoke',        // kill the current subscription link
  'delete',        // soft-delete
  'enable',
  'disable',
]);

export const BulkUsersSchema = z
  .object({
    userIds: z.array(PermissiveUuid).min(1).max(MAX_BULK_USERS),
    action: BulkUserActionSchema,
    /** Required by `extend`, meaningless elsewhere. */
    expireDays: z.number().int().positive().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action === 'extend' && val.expireDays === undefined) {
      ctx.addIssue({ code: 'custom', message: 'extend needs expireDays', path: ['expireDays'] });
    }
  });
export type BulkUsersInput = z.infer<typeof BulkUsersSchema>;

// ───── PUT /api/users/:id ─────

export const UpdateUserSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),             // expired/limited только cron'ом
  trafficLimitGb: z.number().int().positive().nullish(),
  trafficLimitStrategy: TrafficLimitStrategy.optional(),
  expireAt: z.iso.datetime().nullish(),                          // ISO 8601 string OR null
  hwidDeviceLimit: z.number().int().positive().nullish(),
  description: z.string().max(1000).nullish(),
  tag: z.string().max(64).nullish(),
  telegramId: z.union([
    z.number().int(),
    z.string().regex(/^\d+$/),
  ]).nullish(),
  email: z.email().max(255).nullish(),
  groupIds: z.array(PermissiveUuid).optional(),
  // R3 - per-user routing-preset override. Null clears it (back to inherit).
  routingPreset: z.enum(ROUTING_PRESET_IDS).nullable().optional(),
  // Slice 27 follow-up: kept for back-compat, ignored by subscription.
  enabledProtocols: z.array(ProtocolName).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// ───── GET /api/users (query params) ─────

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  // Page SIZE cap, not a ceiling on how many users the list can reach: `page`
  // above walks the whole table (repository turns the pair into skip/take plus
  // a separate count for `total`), and UsersPage has driven both since Wave-14.
  // Spelled out because the previous comment here described a pre-Wave-14 state
  // and read as "this install tops out at 500 users", which is how a reader
  // auditing the code reached exactly that wrong conclusion.
  limit: z.coerce.number().int().positive().max(500).default(50),
  status: UserStatus.optional(),
  search: z.string().min(1).max(64).optional(),                  // matches username/email/telegramId/tag
  groupId: PermissiveUuid.optional(),
  // Exact tag match, distinct from `search` (which also matches username and
  // email): the Filters popover offers a tag the operator already uses, so a
  // substring match there would quietly widen the selection.
  tag: z.string().min(1).max(64).optional(),
  // R3 - who is pinned to a routing preset. `any` = has an override of some
  // kind, `none` = inherits, a preset id = pinned to exactly that one. The
  // override is otherwise invisible in bulk (it sits in a collapsed Advanced
  // block on a single user's page), which is how a one-off fix from months ago
  // turns into an unexplained support ticket.
  routingPreset: z.union([z.enum(ROUTING_PRESET_IDS), z.literal('any'), z.literal('none')]).optional(),
  // The list is paged server-side, so sorting has to be too: sorting the
  // current page only would reorder 25 rows out of N and read as a bug.
  // Default is username asc, the order an operator scans a roster in.
  sort: z.enum(['username', 'createdAt', 'expireAt', 'traffic']).default('username'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

// ───── Path params for /api/users/:id ─────

export const UserIdParamSchema = z.object({
  id: z.uuid(),
});
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
