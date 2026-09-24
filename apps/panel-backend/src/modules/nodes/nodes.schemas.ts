import { z } from 'zod';
import { CORE_COMPONENTS, ENGINE_NAMES } from '@iceslab/shared';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Name may contain letters, digits, dot, underscore, hyphen');

const AddressSchema = z
  .string()
  .min(3, 'Address is required')
  .max(255, 'Address too long')
  // host[:port]: host is IPv4 or DNS, port optional integer
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

/**
 * Э3 F: who answers the name lookups of this node's users.
 *
 * Absent or null (the default, and every node today) means the node renders no
 * `dns` section and the host's own resolver answers. On a cascade that is the
 * wrong machine: the name is resolved by the ENTRY while the connection leaves
 * from the exit (field observation E13), so what is DNS-poisoned in the entry's
 * country stays poisoned, a geo-pinned CDN answers for the wrong country, and
 * the entry's resolver sees every name the user visits.
 *
 * Naming a resolver moves nothing in the routing stages: xray's built-in DNS
 * dials its servers as ordinary connections, so on a cascade entry the query
 * takes the same road as the traffic and is answered from the exit.
 *
 * It lives on the NODE because the core keeps one resolver per PROCESS and the
 * process is one per node. It shipped on the profile first, which put a
 * process-wide value behind a per-profile switch and needed a conflict check at
 * every save; the setting moved instead of the check growing.
 */
export const DnsSchema = z
  .object({
    servers: z
      .array(
        z.object({
          /** Plain IP or a DoH URL. A plain IP dodges the bootstrap problem
           *  of having to resolve the resolver's own hostname. */
          address: z.string().min(1).max(253),
          /** Names this server is authoritative for; empty = all of them. */
          domains: z.array(z.string().min(1).max(253)).max(64).default([]),
          /** Only accept answers inside these ranges, e.g. ["geoip:ru"]. */
          expectIps: z.array(z.string().min(1).max(64)).max(32).default([]),
          /** Keep names this server declined off the general resolver. */
          skipFallback: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(16),
    queryStrategy: z.enum(['UseIP', 'UseIPv4', 'UseIPv6']).optional(),
    disableCache: z.boolean().optional(),
  })
  .nullish();
export type DnsInput = z.infer<typeof DnsSchema>;

/**
 * Node.coreVersions on a write. Keys are CORE_COMPONENTS (an unknown one is a
 * 400, not a silently kept typo); whether a version is one the manifest lists
 * is checked in the service against the merged result, see
 * node-core-versions.ts.
 *
 * On create a value is a version. On update a value may also be null, which
 * puts that component back on the pin; a component left out is not touched, and
 * `coreVersions: null` puts every component back on the pin.
 */
const CoreVersionValueSchema = z.string().min(1).max(64);
const CoreComponentSchema = z.enum(CORE_COMPONENTS);
const CoreVersionsCreateSchema = z.partialRecord(CoreComponentSchema, CoreVersionValueSchema);
const CoreVersionsPatchSchema = z
  .partialRecord(CoreComponentSchema, CoreVersionValueSchema.nullable())
  .nullable();

// Slice 27: keep parity with the inbound/profile protocol enum in
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

/**
 * Which engines the node is set up to carry, first = primary (core-lifecycle.md
 * section 7). At least one, no repeats. How it combines with `protocol` and
 * `singboxEngine` is resolveNodeEngines (node-intended-engines.ts).
 */
const IntendedEnginesSchema = z
  .array(z.enum(ENGINE_NAMES))
  .min(1, 'at least one engine')
  .max(ENGINE_NAMES.length)
  .refine((a) => new Set(a).size === a.length, 'an engine is listed twice');

export const CreateNodeSchema = z.object({
  name: NameSchema,
  address: AddressSchema,
  // Optional now: `intendedEngines` can name the primary instead. Neither sent
  // is the old default, xray.
  protocol: ProtocolSchema.optional(),
  intendedEngines: IntendedEnginesSchema.optional(),
  countryCode: CountryCodeSchema.nullish(),
  consumptionMultiplier: z.number().int().positive().default(1),
  // Slice 27.5
  regionId: z.uuid().nullable().optional(),
  maxUsers: z.number().int().positive().max(100000).nullable().optional(),
  // B3/G
  domain: DomainSchema,
  hardening: HardeningSchema,
  // Engine-choice: also install the sing-box engine (--with-singbox). The old
  // form of "singbox is in intendedEngines"; no default, absent is no edit.
  singboxEngine: z.boolean().optional(),
  // Э3 F: the resolver this node's users get. Absent = the host's own.
  dns: DnsSchema,
  // Which core versions to install; absent components get the pin.
  coreVersions: CoreVersionsCreateSchema.optional(),
});
export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;

export const UpdateNodeSchema = z.object({
  name: NameSchema.optional(),
  address: AddressSchema.optional(),
  protocol: ProtocolSchema.optional(),
  // Absent = untouched; a list replaces the list. No null: a node carries at
  // least its primary engine.
  intendedEngines: IntendedEnginesSchema.optional(),
  countryCode: CountryCodeSchema.nullish(),
  consumptionMultiplier: z.number().int().positive().optional(),
  regionId: z.uuid().nullable().optional(),
  maxUsers: z.number().int().positive().max(100000).nullable().optional(),
  domain: DomainSchema,
  hardening: HardeningSchema,
  singboxEngine: z.boolean().optional(),
  // Э3: the node-level routing policy this node runs. null detaches it, which
  // rewrites the node's config without the rules rather than leaving the last
  // policy running.
  policyId: z.uuid().nullable().optional(),
  // Э3 F: the resolver this node's users get. null clears it, which rewrites
  // the config WITHOUT a dns section rather than leaving the last resolver
  // answering on a node the panel shows as having none.
  dns: DnsSchema,
  // Absent = untouched; per component: version sets, null puts back on the
  // pin, left out is untouched; null for the whole map = every pin. No
  // .default(): an absent key must reach the service as absent.
  coreVersions: CoreVersionsPatchSchema.optional(),
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
