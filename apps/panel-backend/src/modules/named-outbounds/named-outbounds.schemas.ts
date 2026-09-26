import { z } from 'zod';

/**
 * Phase 10 (Э3.2): what a named outbound may say, per type. The set is closed
 * (client plan, Э3.2) and each type narrow: vless over raw TCP only, socks5
 * only. Whatever a type does not name is refused, not carried: a field the
 * chain does not draw is a promise the node would not keep.
 */

export const NAMED_OUTBOUND_TYPES = ['vless', 'socks', 'freedom', 'blackhole'] as const;
export type NamedOutboundType = (typeof NAMED_OUTBOUND_TYPES)[number];

/** The types a cascade direction may stand on (ARCH 26.09). freedom and
 *  blackhole are the node policy's direct and block already; they exist here
 *  for importing the operator's own config. */
export const DIRECTION_OUTBOUND_TYPES: readonly NamedOutboundType[] = ['vless', 'socks'];

const NameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens, starting with a letter or digit');

const HostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:-]+$/, 'a hostname, an IPv4 or an IPv6 address');

const PortSchema = z.number().int().min(1).max(65535);

/** The uTLS fingerprints the chain's engine (sing-box 1.13) takes. */
const FINGERPRINTS = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized'] as const;

const VlessConfigSchema = z
  .object({
    server: HostSchema,
    port: PortSchema,
    uuid: z.uuid(),
    flow: z.literal('xtls-rprx-vision').nullable().default(null),
    security: z.enum(['none', 'tls', 'reality']),
    sni: HostSchema.optional(),
    fingerprint: z.enum(FINGERPRINTS).optional(),
    alpn: z.array(z.string().min(1).max(32)).max(8).optional(),
    realityPublicKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/, 'a REALITY public key, 43 base64url characters')
      .optional(),
    realityShortId: z
      .string()
      .regex(/^([0-9a-f]{2}){0,8}$/, 'a REALITY short id, 0-16 hex characters in pairs')
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const say = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (c.security === 'reality') {
      if (!c.realityPublicKey) say('realityPublicKey', 'REALITY needs the server public key');
      if (c.realityShortId === undefined) say('realityShortId', 'REALITY needs a short id (it may be empty)');
      if (!c.sni) say('sni', 'REALITY needs the server name it poses as');
    } else {
      if (c.realityPublicKey !== undefined) say('realityPublicKey', 'only with security reality');
      if (c.realityShortId !== undefined) say('realityShortId', 'only with security reality');
    }
    // Vision rides TLS or REALITY; over plain TCP the server refuses it.
    if (c.flow && c.security === 'none') say('flow', 'xtls-rprx-vision needs security tls or reality');
    if (c.security === 'none' && (c.sni || c.fingerprint || c.alpn)) {
      say('security', 'sni, fingerprint and alpn mean something only with tls or reality');
    }
  });

const SocksConfigSchema = z
  .object({
    server: HostSchema,
    port: PortSchema,
    username: z.string().min(1).max(255).optional(),
    password: z.string().min(1).max(255).optional(),
  })
  .strict()
  .refine((c) => (c.username === undefined) === (c.password === undefined), {
    message: 'username and password go together',
    path: ['password'],
  });

const EmptyConfigSchema = z.object({}).strict();

export const CONFIG_SCHEMAS: Record<NamedOutboundType, z.ZodType> = {
  vless: VlessConfigSchema,
  socks: SocksConfigSchema,
  freedom: EmptyConfigSchema,
  blackhole: EmptyConfigSchema,
};

const CountryCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase());

export const CreateNamedOutboundSchema = z
  .object({
    name: NameSchema,
    type: z.enum(NAMED_OUTBOUND_TYPES),
    countryCode: CountryCodeSchema.nullish(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .transform((v, ctx) => {
    const parsed = CONFIG_SCHEMAS[v.type].safeParse(v.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ['config', ...issue.path] } as never);
      return z.NEVER;
    }
    return { ...v, config: parsed.data as Record<string, unknown> };
  });
export type CreateNamedOutboundInput = z.infer<typeof CreateNamedOutboundSchema>;

/**
 * Absent = untouched. `type` and `config` travel together: a config is only
 * meaningful against its type, and a type change without one would leave the
 * old type's fields standing under the new name. The service checks the pair
 * against the per-type schema.
 */
export const UpdateNamedOutboundSchema = z
  .object({
    name: NameSchema.optional(),
    type: z.enum(NAMED_OUTBOUND_TYPES).optional(),
    countryCode: CountryCodeSchema.nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((v) => v.type === undefined || v.config !== undefined, {
    message: 'a new type needs its config in the same save',
    path: ['config'],
  });
export type UpdateNamedOutboundInput = z.infer<typeof UpdateNamedOutboundSchema>;

export const NamedOutboundIdParamSchema = z.object({ id: z.uuid() });
