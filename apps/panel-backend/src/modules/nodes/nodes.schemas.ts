import { z } from 'zod';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Name may contain letters, digits, dot, underscore, hyphen');

const AddressSchema = z
  .string()
  .min(3, 'Address is required')
  .max(255, 'Address too long')
  // host[:port] — host is IPv4 or DNS, port optional integer
  .regex(
    /^[a-zA-Z0-9.-]+(:\d{1,5})?$/,
    'Address must be host or host:port (IPv4 or DNS, no scheme)',
  );

const CountryCodeSchema = z.string().length(2).regex(/^[A-Z]{2}$/);

// B3/G - node FQDN for REALITY self-steal serverName (+ future ACME). Bare host,
// no scheme, no port. A-record it to THIS node's IP so SNI and IP stay
// consistent (the mismatch RU-DPI detects). Empty/null = no self-steal/ACME.
const DomainSchema = z
  .string()
  .max(255)
  .regex(/^[a-zA-Z0-9.-]+$/, 'Domain must be a bare FQDN (no scheme, no port)')
  .nullish();

// G (Zashchita / hardening) - probe-resistance toggles persisted to
// nodes.hardening (jsonb). Json column so future toggles add here without a
// migration; the install script + agent only read the flags they understand.
// .strict() rejects unknown keys so a typo'd flag fails loud (400) instead of
// silently persisting a no-op key.
const SshAllowEntrySchema = z
  .string()
  .max(64)
  // IPv4, IPv4/CIDR, or bare IPv6 - same shape the script feeds `ufw allow from`.
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Must be an IP or CIDR');

export const HardeningSchema = z
  .object({
    ufwLockdown: z.boolean().optional(),
    fail2ban: z.boolean().optional(),
    realisticFallback: z.boolean().optional(),
    sshAllowlist: z.array(SshAllowEntrySchema).max(16).optional(),
  })
  .strict()
  .nullish();
export type HardeningInput = z.infer<typeof HardeningSchema>;

// Slice 27 — keep parity with the inbound/profile protocol enum in
// inbounds.schemas.ts. Node.protocol is a label for "which adapter is the
// primary / installed on this VPS"; the actual deployment is per-binding.
const ProtocolSchema = z.enum([
  'xray',
  'hysteria',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
  'tuic',
  'anytls',
  'shadowtls',
]);

export const CreateNodeSchema = z.object({
  name: NameSchema,
  address: AddressSchema,
  protocol: ProtocolSchema.default('xray'),
  countryCode: CountryCodeSchema.nullish(),
  consumptionMultiplier: z.number().int().positive().default(1),
  // Slice 27.5
  regionId: z.uuid().nullable().optional(),
  maxUsers: z.number().int().positive().max(100000).nullable().optional(),
  // B3/G
  domain: DomainSchema,
  hardening: HardeningSchema,
});
export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;

export const UpdateNodeSchema = z.object({
  name: NameSchema.optional(),
  address: AddressSchema.optional(),
  protocol: ProtocolSchema.optional(),
  countryCode: CountryCodeSchema.nullish(),
  consumptionMultiplier: z.number().int().positive().optional(),
  regionId: z.uuid().nullable().optional(),
  maxUsers: z.number().int().positive().max(100000).nullable().optional(),
  domain: DomainSchema,
  hardening: HardeningSchema,
});
export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;

export const ListNodesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.string().max(16).optional(),
  regionId: z.uuid().optional(),
});
export type ListNodesQuery = z.infer<typeof ListNodesQuerySchema>;

export const NodeIdParamSchema = z.object({
  id: z.uuid(),
});
export type NodeIdParam = z.infer<typeof NodeIdParamSchema>;
