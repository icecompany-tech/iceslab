import { z } from 'zod';
import {
  PROTOCOL_CONFIG_SCHEMAS,
  type CreateInboundInput,
} from '../inbounds/inbounds.schemas.js';

// We reuse per-protocol config schemas from the old inbounds module — they
// describe the SHARED part of each profile's config and stay valid as
// `Profile.config`. Per-node fields (ACME domain, AmneziaWG private key,
// Shadowsocks server PSK, MTProto derived secret, ...) move to
// ProfileNodeBinding.overrides — see resolveBindingConfig() in profiles.service.

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, underscore, hyphen');

const PortSchema = z.number().int().min(1).max(65535);

const PublicHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
    'Must be a valid hostname or IPv4',
  );

export const ProtocolEnum = z.enum([
  'hysteria',
  'xray',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
]);

// Engine-choice (EC5): which proxy core serves a profile. null = native.
export const EngineEnum = z.enum(['xray', 'hysteria', 'singbox']);

// Which engines each protocol may be served by. The shared protocols can run on
// their native core OR sing-box; everything else has a single native core, so
// its engine must stay null (native).
const ENGINE_OPTIONS: Record<string, readonly string[]> = {
  xray: ['xray', 'singbox'],
  shadowsocks: ['xray', 'singbox'],
  hysteria: ['hysteria', 'singbox'],
};

/** A null/undefined engine (native) is always valid; a set engine must be one
 *  of the protocol's allowed cores. */
export function engineValidForProtocol(
  protocol: string,
  engine: string | null | undefined,
): boolean {
  if (!engine) return true;
  return (ENGINE_OPTIONS[protocol] ?? []).includes(engine);
}

// Discriminated union — same shape as the old InboundConfigByProtocol but
// without the per-node `nodeId/port/publicHost` fields. Profile holds the
// shared template only.
const ProfileConfigByProtocol = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal('hysteria'),    config: PROTOCOL_CONFIG_SCHEMAS.hysteria }),
  z.object({ protocol: z.literal('xray'),        config: PROTOCOL_CONFIG_SCHEMAS.xray }),
  z.object({ protocol: z.literal('amneziawg'),   config: PROTOCOL_CONFIG_SCHEMAS.amneziawg }),
  z.object({ protocol: z.literal('naive'),       config: PROTOCOL_CONFIG_SCHEMAS.naive }),
  z.object({ protocol: z.literal('shadowsocks'), config: PROTOCOL_CONFIG_SCHEMAS.shadowsocks }),
  z.object({ protocol: z.literal('mtproto'),     config: PROTOCOL_CONFIG_SCHEMAS.mtproto }),
  z.object({ protocol: z.literal('mieru'),       config: PROTOCOL_CONFIG_SCHEMAS.mieru }),
]);

const ProfileBaseFields = z.object({
  name: NameSchema,
  description: z.string().max(500).nullish(),
  enabled: z.boolean().default(true),
  /** Engine-choice (EC5): null/omitted = native core, 'singbox' = sing-box. */
  engine: EngineEnum.nullish(),
});

export const CreateProfileSchema = z
  .intersection(ProfileBaseFields, ProfileConfigByProtocol)
  .superRefine((val, ctx) => {
    if (!engineValidForProtocol(val.protocol, val.engine ?? null)) {
      ctx.addIssue({
        code: 'custom',
        message: `engine "${val.engine}" is not valid for protocol "${val.protocol}"`,
        path: ['engine'],
      });
    }
  });
export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;

// Profile updates never change the protocol (would invalidate every
// binding's overrides). To switch protocol, delete + recreate.
export const UpdateProfileSchema = z.object({
  name: NameSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  /** Engine-choice (EC5). Validated against the profile's protocol in service. */
  engine: EngineEnum.nullable().optional(),
  /** Must match the profile's existing protocol. Validated in service. */
  config: z.unknown().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

// ───── Bindings ─────

export const CreateBindingSchema = z.object({
  profileId: z.uuid(),
  nodeId: z.uuid(),
  port: PortSchema,
  publicHost: PublicHostSchema.optional()
    .or(z.literal('').transform(() => undefined))
    .optional(),
  publicPort: PortSchema.optional(),
  /** Per-node overrides over Profile.config. Validated by the protocol's
   *  config schema (partial). */
  overrides: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().default(true),
});
export type CreateBindingInput = z.infer<typeof CreateBindingSchema>;

export const UpdateBindingSchema = z.object({
  port: PortSchema.optional(),
  publicHost: PublicHostSchema.nullable()
    .or(z.literal('').transform(() => null))
    .optional(),
  publicPort: PortSchema.nullable().optional(),
  overrides: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateBindingInput = z.infer<typeof UpdateBindingSchema>;

export const BulkBindSchema = z.object({
  /** Bind this profile to all of these nodes in one call. Existing bindings
   *  for the same (profile, node) pair are skipped — idempotent. */
  profileId: z.uuid(),
  nodeIds: z.array(z.uuid()).min(1).max(100),
  port: PortSchema,
});
export type BulkBindInput = z.infer<typeof BulkBindSchema>;

// ───── Common ─────

export const ProfileIdParamSchema = z.object({ id: z.uuid() });
export const BindingIdParamSchema = z.object({ id: z.uuid() });

export const ListProfilesQuerySchema = z.object({
  protocol: ProtocolEnum.optional(),
});
export type ListProfilesQuery = z.infer<typeof ListProfilesQuerySchema>;

export const ListBindingsQuerySchema = z.object({
  nodeId: z.uuid().optional(),
  profileId: z.uuid().optional(),
});
export type ListBindingsQuery = z.infer<typeof ListBindingsQuerySchema>;

// Re-export for convenience
export type { CreateInboundInput };
