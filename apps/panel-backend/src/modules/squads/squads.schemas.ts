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

// A4 increment 2 - per-cascade exit allow-list. Each entry names a cascade and
// the exit nodes this squad grants for it. Three states per cascade:
//   - absent            -> no restriction from this squad, every exit;
//   - exitNodeIds: [x]  -> only those exits;
//   - exitNodeIds: []   -> the cascade is OFF for this squad, no line of it is
//                          built. Stored (GroupCascadeOff); until 2026-09-24 an
//                          empty list was dropped and read as "absent".
const ExitAclEntry = z.object({
  cascadeId: z.uuid(),
  exitNodeIds: z.array(z.uuid()),
});

// One entry per cascade. Two entries for one cascade would have to be merged by
// a rule nobody asked for ([] and [x]: off or restricted?), so they are refused.
const ExitAcl = z.array(ExitAclEntry).refine(
  (list) => new Set(list.map((e) => e.cascadeId)).size === list.length,
  { message: 'One exitAcl entry per cascade' },
);

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
  exitAcl: ExitAcl.default([]),
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
  exitAcl: ExitAcl.optional(),
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
