import { z } from 'zod';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { PermissiveUuid } from '../../lib/util/uuid-schema.js';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[A-Za-z0-9 _-]+$/, 'Letters, digits, space, underscore, hyphen');

// R3-a - optional per-squad routing-preset override (null = inherit panel default).
const RoutingPresetField = z.enum(ROUTING_PRESET_IDS).nullish();

// A4 increment 2 - per-cascade exit allow-list. Each entry names a balancer
// cascade and the exit nodes this squad grants for it. OPT-IN: a cascade absent
// here (or an empty list) means no restriction from this squad. An empty
// `exitNodeIds` is treated as "no rows" (omitted at persist time).
const ExitAclEntry = z.object({
  cascadeId: z.uuid(),
  exitNodeIds: z.array(z.uuid()),
});

export const CreateSquadSchema = z.object({
  name: NameSchema,
  description: z.string().max(1000).nullish(),
  routingPreset: RoutingPresetField,
  // K7 - per-squad HWID device-limit default (null = none).
  hwidDeviceLimit: z.number().int().positive().nullish(),
  /** Slice 27: squad ACL is now profile-level. Initial profile assignment;
   *  admin can attach later via PUT. */
  profileIds: z.array(z.uuid()).default([]),
  /** Which HOSTS of those profiles the squad hands out. OPT-IN RESTRICTION,
   *  same rule as `exitAcl`: empty = every host of every granted profile. */
  hostIds: z.array(z.uuid()).default([]),
  /** A4 increment 2: per-cascade exit allow-list. Empty = no exit restriction. */
  exitAcl: z.array(ExitAclEntry).default([]),
  /** A4 ad-split: extra route-policies this squad grants its members. Empty =
   *  only the plain profile. */
  policyIds: z.array(z.uuid()).default([]),
});
export type CreateSquadInput = z.infer<typeof CreateSquadSchema>;

export const UpdateSquadSchema = z.object({
  name: NameSchema.optional(),
  description: z.string().max(1000).nullish(),
  routingPreset: RoutingPresetField,
  hwidDeviceLimit: z.number().int().positive().nullish(),
  /** When provided, replaces the full profile set (set semantics). */
  profileIds: z.array(z.uuid()).optional(),
  /** When provided, replaces the full host allow-list. An EMPTY array is
   *  meaningful: it clears the restriction, putting the squad back to every
   *  host of its profiles. */
  hostIds: z.array(z.uuid()).optional(),
  /** When provided, replaces the full exit allow-list (set semantics). */
  exitAcl: z.array(ExitAclEntry).optional(),
  /** When provided, replaces the full route-policy grant set (set semantics). */
  policyIds: z.array(z.uuid()).optional(),
});
export type UpdateSquadInput = z.infer<typeof UpdateSquadSchema>;

// PermissiveUuid: SquadIdParamSchema accepts the seeded "All" squad
// (00000000-0000-0000-0000-000000000001, non-v4 version digit) when admin
// hits PUT/DELETE /api/squads/:id. The service layer rejects All with a
// friendly SquadProtectedError; without the permissive shape the request
// would die at Zod with a confusing 400.
export const SquadIdParamSchema = z.object({ id: PermissiveUuid });
