import { z } from 'zod';
import { XRAY_PLAIN_SUBPROTOCOLS } from '@iceslab/shared';
import {
  PROTOCOL_CONFIG_SCHEMAS,
  type CreateInboundInput,
} from '../inbounds/inbounds.schemas.js';

// We reuse per-protocol config schemas from the old inbounds module, they
// describe the SHARED part of each profile's config and stay valid as
// `Profile.config`. Per-node fields (ACME domain, AmneziaWG private key,
// Shadowsocks server PSK, MTProto derived secret, ...) move to
// ProfileNodeBinding.overrides: see resolveBindingConfig() in profiles.service.

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
  // sing-box-only trio. Everything else about them already existed - the node
  // adapter, the inbound config schemas, credential fan-out, share links, and
  // the profile form that offers all three - but a profile could not be saved,
  // and deployment goes only through ProfileNodeBinding -> Profile. So they
  // were unreachable for an operator and untestable in the field (audit A-029).
  'tuic',
  'anytls',
  'shadowtls',
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
  // sing-box is not one option among several for these three, it is the only
  // core that speaks them. Listing it anyway is what lets an operator SAY so:
  // without an entry here the protocol saves only with a null engine, and a
  // form that sends `engine: 'singbox'` is refused with a message about an
  // invalid engine, which reads as "this protocol is broken".
  tuic: ['singbox'],
  anytls: ['singbox'],
  shadowtls: ['singbox'],
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

/**
 * socks and http are served by the xray process and nothing else (decision of
 * 23.09: one process, no new adapters). The sing-box adapter refuses them on
 * the node, loudly but late; here the save says so while the operator is
 * still on the form. Undefined config reads as "no subprotocol named".
 */
export function engineServesSubprotocol(
  protocol: string,
  engine: string | null | undefined,
  config: unknown,
): boolean {
  if (protocol !== 'xray' || engine !== 'singbox') return true;
  const sub = (config as { subprotocol?: unknown } | null | undefined)?.subprotocol;
  return !(XRAY_PLAIN_SUBPROTOCOLS as readonly unknown[]).includes(sub);
}

/** The code every door answers this refusal with: `params.code` on the create
 *  issue, `error` on the edit and binding answers. */
export const SINGBOX_XRAY_FAMILY_CODE = 'SINGBOX_XRAY_FAMILY';

export const SINGBOX_XRAY_FAMILY_MESSAGE =
  'sing-box serves the xray family only as REALITY over raw; use the xray engine for TLS, none, self-steal and other transports';

export type SingboxXrayField = 'security' | 'realityMode' | 'network';

/**
 * The field that keeps an xray-family profile (vless, vmess, trojan) off the
 * sing-box engine, or null when sing-box can serve it.
 *
 * The rule is the agent's, mirrored here so the save says it instead of a
 * failed push: apps/node/internal/core/singbox/adapter.go, toInboundConfig
 * (lines 441-449 on 2026-09-24) refuses security other than reality (tls/none
 * need operator certificates on sing-box, deferred), REALITY self-steal (the
 * local TLS fallback lives in the xray adapter) and any network but raw. A
 * change there is a change here; the agent's comment names this function.
 *
 * Read on the config as it will be stored or pushed, the schema defaults
 * filled in (reality, steal-others, raw). An absent or empty value passes, as
 * on the agent. socks and http answer engineServesSubprotocol, not this.
 */
export function singboxRefusesXrayField(
  protocol: string,
  engine: string | null | undefined,
  config: unknown,
): SingboxXrayField | null {
  if (protocol !== 'xray' || engine !== 'singbox') return null;
  const c = (config ?? {}) as {
    subprotocol?: unknown;
    security?: unknown;
    realityMode?: unknown;
    network?: unknown;
  };
  if ((XRAY_PLAIN_SUBPROTOCOLS as readonly unknown[]).includes(c.subprotocol)) return null;
  const set = (v: unknown) => v !== undefined && v !== null && v !== '';
  if (set(c.security) && c.security !== 'reality') return 'security';
  if (c.realityMode === 'self-steal') return 'realityMode';
  if (set(c.network) && c.network !== 'raw') return 'network';
  return null;
}

// Discriminated union, same shape as the old InboundConfigByProtocol but
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
  z.object({ protocol: z.literal('tuic'),        config: PROTOCOL_CONFIG_SCHEMAS.tuic }),
  z.object({ protocol: z.literal('anytls'),      config: PROTOCOL_CONFIG_SCHEMAS.anytls }),
  z.object({ protocol: z.literal('shadowtls'),   config: PROTOCOL_CONFIG_SCHEMAS.shadowtls }),
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
    if (!engineServesSubprotocol(val.protocol, val.engine ?? null, val.config)) {
      ctx.addIssue({
        code: 'custom',
        message: 'socks and http are served by the xray engine only',
        path: ['engine'],
      });
    }
    const field = singboxRefusesXrayField(val.protocol, val.engine ?? null, val.config);
    if (field) {
      ctx.addIssue({
        code: 'custom',
        message: SINGBOX_XRAY_FAMILY_MESSAGE,
        path: ['config', field],
        params: { code: SINGBOX_XRAY_FAMILY_CODE },
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
   *  for the same (profile, node) pair are skipped, idempotent. */
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
