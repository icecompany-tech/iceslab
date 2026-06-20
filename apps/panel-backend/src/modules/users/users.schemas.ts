import { z } from 'zod';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { PermissiveUuid } from '../../lib/uuid-schema.js';

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
  // 500 is generous; UsersPage front asks for 200 to render the table without
  // pagination at typical commercial-scale (≤500 users). When the install
  // grows past that, swap to server-side pagination on the page.
  limit: z.coerce.number().int().positive().max(500).default(50),
  status: UserStatus.optional(),
  search: z.string().min(1).max(64).optional(),                  // matches username/email/telegramId/tag
  groupId: PermissiveUuid.optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

// ───── Path params for /api/users/:id ─────

export const UserIdParamSchema = z.object({
  id: z.uuid(),
});
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
