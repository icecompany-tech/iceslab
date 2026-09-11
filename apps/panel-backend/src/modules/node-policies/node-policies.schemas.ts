import { z } from 'zod';

/**
 * Э3 layer B: what a NODE does with traffic.
 *
 * The wire shape lives in `@iceslab/shared` (NodePolicy). This is the panel's
 * side of it, and the two differ in one deliberate place: a rule that routes
 * through a cascade stores the DIRECTION ID here and is rendered into an
 * outbound name only at push time. See the model comment in
 * prisma/models/node-policy.prisma for why storing the name would be wrong.
 */

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long');

/** Engine-neutral matcher entries: "geosite:category-ru", "geoip:ru",
 *  "domain:example.com", plain hostnames, CIDRs. The node translates. */
const MatchEntry = z.string().min(1).max(253);

export const PolicyActionKind = z.enum(['direct', 'block', 'warp', 'cascade']);
export type PolicyActionKindValue = z.infer<typeof PolicyActionKind>;

export const PolicyRuleSchema = z
  .object({
    /** Kept across a save so an edit does not re-create rows and lose their
     *  identity; absent = a new rule. */
    id: z.uuid().optional(),
    enabled: z.boolean().default(true),
    match: z
      .object({
        domain: z.array(MatchEntry).max(200).default([]),
        ip: z.array(MatchEntry).max(200).default([]),
        port: z.string().max(64).nullish(),
        protocol: z.array(z.string().min(1).max(32)).max(16).default([]),
        network: z.enum(['tcp', 'udp', 'tcp,udp']).nullish(),
      })
      .default({ domain: [], ip: [], protocol: [] }),
    action: z.object({
      kind: PolicyActionKind,
      /** Cascade only: which way out. */
      directionId: z.uuid().nullish(),
    }),
  })
  .superRefine((val, ctx) => {
    // A cascade rule with no direction has nowhere to send traffic, and a
    // direction on any other kind is a leftover from switching the action in
    // the form. Both are accepted silently by a plain shape check and then mean
    // something the operator did not ask for.
    if (val.action.kind === 'cascade' && !val.action.directionId) {
      ctx.addIssue({
        code: 'custom',
        message: 'a cascade rule must name the direction it goes out through',
        path: ['action', 'directionId'],
      });
    }
    if (val.action.kind !== 'cascade' && val.action.directionId) {
      ctx.addIssue({
        code: 'custom',
        message: `a ${val.action.kind} rule cannot carry a cascade direction`,
        path: ['action', 'directionId'],
      });
    }
  });
export type PolicyRuleInput = z.infer<typeof PolicyRuleSchema>;

export const CreateNodePolicySchema = z.object({
  name: NameSchema,
  description: z.string().max(500).nullish(),
  /** The whole ordered list. A policy IS its order, so rules are written as a
   *  set: sending a partial list would silently delete the rest. The screen
   *  edits the whole list, which is the condition that makes set-replacing
   *  right here and wrong elsewhere. */
  rules: z.array(PolicyRuleSchema).max(200).default([]),
});
export type CreateNodePolicyInput = z.infer<typeof CreateNodePolicySchema>;

export const UpdateNodePolicySchema = z.object({
  name: NameSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  /** Omit to leave the rules alone; send the full ordered list to replace it. */
  rules: z.array(PolicyRuleSchema).max(200).optional(),
});
export type UpdateNodePolicyInput = z.infer<typeof UpdateNodePolicySchema>;

export const NodePolicyIdParamSchema = z.object({ id: z.uuid() });
