import { z } from 'zod';

// Format names accepted in `disableForFormats[]`. Mirrors the union in
// subscription.routes.ts (?format=...). Keep in sync.
const FormatEnum = z.enum([
  'plain',
  'clash',
  'singbox',
  'xrayjson',
  'wgconf',
  'mieru-json',
]);

const SecurityLayerEnum = z.enum(['default', 'tls', 'none']);

export const HostIdParamSchema = z.object({ id: z.uuid() });

export const ListHostsQuerySchema = z.object({
  bindingId: z.uuid().optional(),
  profileId: z.uuid().optional(),
  // F7 - fetch every host across all of a node's bindings in one call (the
  // NodeEditModal used to mount one ['hosts', bindingId] query per binding).
  nodeId: z.uuid().optional(),
});

export const CreateHostSchema = z.object({
  bindingId: z.uuid(),
  remark: z.string().min(1).max(64).default('Default'),
  priority: z.number().int().min(0).max(1000).default(0),
  enabled: z.boolean().default(true),
  addressOverride: z.string().min(1).max(253).nullable().optional(),
  portOverride: z.number().int().min(1).max(65535).nullable().optional(),
  sniOverride: z.string().min(1).max(253).nullable().optional(),
  hostHeaderOverride: z.string().min(1).max(253).nullable().optional(),
  pathOverride: z.string().min(1).max(253).nullable().optional(),
  fingerprintOverride: z
    .enum(['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'])
    .nullable()
    .optional(),
  alpn: z.array(z.string().min(1).max(16)).max(8).default([]),
  allowInsecure: z.boolean().default(false),
  securityLayer: SecurityLayerEnum.default('default'),
  disableForFormats: z.array(FormatEnum).default([]),
});

// All fields optional on update; bindingId immutable (move requires delete+create).
export const UpdateHostSchema = CreateHostSchema.partial().omit({ bindingId: true });

export const ReorderHostsSchema = z.object({
  // Ordered list of host IDs. Service rewrites their `priority` to match
  // index in the array. Hosts outside the list are left untouched.
  hostIds: z.array(z.uuid()).min(1).max(64),
});

export type CreateHostInput = z.infer<typeof CreateHostSchema>;
export type UpdateHostInput = z.infer<typeof UpdateHostSchema>;
export type ReorderHostsInput = z.infer<typeof ReorderHostsSchema>;
export type ListHostsQuery = z.infer<typeof ListHostsQuerySchema>;
