import { z } from 'zod';
import { ROUTING_PRESET_IDS } from '@iceslab/shared';
import { PermissiveUuid } from '../../lib/util/uuid-schema.js';
import { BOTH_PRESETS_MESSAGE, bothPresetsGiven } from '../routing-presets/routing-presets.assign.js';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[A-Za-z0-9 _-]+$/, 'Letters, digits, space, underscore, hyphen');

// R3-a - optional per-squad routing-preset override (null = inherit panel default).
const RoutingPresetField = z.enum(ROUTING_PRESET_IDS).nullish();
// A-229 - or the operator's own preset, by id. Never together with the
// built-in key: both values in one request are refused, a value on one side
// clears the other on write.
const CustomRoutingPresetField = z.uuid().nullish();

// A4 increment 2 - per-cascade exit allow-list. Each entry names a cascade and
// the exit nodes this squad grants for it. Three states per cascade:
//   - absent            -> no restriction from this squad, every exit;
//   - exitNodeIds: [x]  -> only those exits;
//   - exitNodeIds: []   -> the cascade is OFF for this squad, no line of it is
//                          built. Stored (GroupCascadeOff); until 2026-09-24 an
//                          empty list was dropped and read as "absent".
//
// A-149: keyed by DIRECTION. `directionIds` is the list; `exitNodeIds` is
// still accepted for the screen that has not moved yet and is mapped on the
// server to the directions whose pool holds those nodes (a legacy hop cascade,
// which has no directions, keeps node rows). When both come, directionIds
// wins. Off is the given list empty.
const ExitAclEntry = z
  .object({
    cascadeId: z.uuid(),
    directionIds: z.array(z.uuid()).optional(),
    exitNodeIds: z.array(z.uuid()).optional(),
  })
  .refine((e) => e.directionIds !== undefined || e.exitNodeIds !== undefined, {
    message: 'exitAcl entry needs directionIds (or exitNodeIds)',
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
  customRoutingPresetId: CustomRoutingPresetField,
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
}).refine((v) => !bothPresetsGiven(v), { message: BOTH_PRESETS_MESSAGE, path: ['customRoutingPresetId'] });
export type CreateSquadInput = z.infer<typeof CreateSquadSchema>;

export const UpdateSquadSchema = z.object({
  name: NameSchema.optional(),
  description: z.string().max(1000).nullish(),
  routingPreset: RoutingPresetField,
  customRoutingPresetId: CustomRoutingPresetField,
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
}).refine((v) => !bothPresetsGiven(v), { message: BOTH_PRESETS_MESSAGE, path: ['customRoutingPresetId'] });
export type UpdateSquadInput = z.infer<typeof UpdateSquadSchema>;

const OrderIds = z.array(PermissiveUuid.transform((id) => id.toLowerCase())).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: 'Squad IDs must be unique' },
);

export const ReorderSquadsSchema = z.object({ expectedIds: OrderIds, ids: OrderIds }).refine(
  ({ expectedIds, ids }) => {
    const expected = new Set(expectedIds);
    return expected.size === ids.length && ids.every((id) => expected.has(id));
  },
  { message: 'Both orders must contain the same squad IDs', path: ['ids'] },
);
export type ReorderSquadsInput = z.infer<typeof ReorderSquadsSchema>;

// PermissiveUuid: SquadIdParamSchema accepts the seeded "All" squad
// (00000000-0000-0000-0000-000000000001, non-v4 version digit) when admin
// hits PUT/DELETE /api/squads/:id. The service layer rejects All with a
// friendly SquadProtectedError; without the permissive shape the request
// would die at Zod with a confusing 400.
export const SquadIdParamSchema = z.object({ id: PermissiveUuid });
