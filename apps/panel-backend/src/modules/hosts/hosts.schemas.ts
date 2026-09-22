import { z } from 'zod';
import { FORMAT_NAMES } from '@iceslab/shared';

// Format names accepted in `disableForFormats[]`.
//
// ⚠ The SHARED list, not a mirror of it. "Keep in sync" is what this comment
// used to say, and it had not been true for months: this copy was missing
// `xrayjson-array` and `amneziavpn` and carried `mieru-json`, which the
// subscription has never served. So a host disabled for a format the operator
// could see on the page was refused with a 400 here, and a host disabled for
// `mieru-json` disabled nothing at all.
const FormatEnum = z.enum(FORMAT_NAMES);

const SecurityLayerEnum = z.enum(['default', 'tls', 'none']);

export const HostIdParamSchema = z.object({ id: z.uuid() });

export const ListHostsQuerySchema = z.object({
  bindingId: z.uuid().optional(),
  profileId: z.uuid().optional(),
  // F7 - fetch every host across all of a node's bindings in one call (the
  // NodeEditModal used to mount one ['hosts', bindingId] query per binding).
  nodeId: z.uuid().optional(),
});

export const CreateHostSchema = z
  .object({
    /**
     * Two ways in, and the second is the one an operator's panel uses.
     *
     * `bindingId` attaches to a binding that already exists. That was the only
     * way until 2026-07-30, and it made the create-host screen impossible to
     * finish on a fresh install: picking a node looked up an existing binding
     * for (profile, node), found none, and left the form with nothing selected
     * and a permanently disabled button. Nothing in the new UI creates a
     * binding either, so a freshly installed panel could not produce a single
     * host by any route.
     *
     * `profileId` + `nodeId` + `port` says what the operator actually means:
     * serve this profile from this node on this port. The binding is our
     * internal join and gets created here, in the same transaction as the host,
     * so a failure leaves neither behind rather than an invisible orphan.
     * An existing binding for that pair is reused, which makes the call
     * idempotent instead of erroring on the second host for the same node.
     */
    bindingId: z.uuid().optional(),
    profileId: z.uuid().optional(),
    nodeId: z.uuid().optional(),
    /** Listen port for the binding. Required only when creating one. */
    port: z.number().int().min(1).max(65535).optional(),
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
  })
  .superRefine((val, ctx) => {
    if (val.bindingId) return;
    // Spelled out per field rather than as one "invalid body": the caller is a
    // form, and it needs to know which control to point at.
    for (const key of ['profileId', 'nodeId', 'port'] as const) {
      if (val[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `${key} is required when bindingId is omitted`,
          path: [key],
        });
      }
    }
  });

// All fields optional on update; the binding is immutable (moving a host to
// another node is a delete plus a create, not an edit).
export const UpdateHostSchema = z
  .object({
    remark: z.string().min(1).max(64).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    enabled: z.boolean().optional(),
    addressOverride: z.string().min(1).max(253).nullable().optional(),
    portOverride: z.number().int().min(1).max(65535).nullable().optional(),
    sniOverride: z.string().min(1).max(253).nullable().optional(),
    hostHeaderOverride: z.string().min(1).max(253).nullable().optional(),
    pathOverride: z.string().min(1).max(253).nullable().optional(),
    fingerprintOverride: z
      .enum(['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random'])
      .nullable()
      .optional(),
    alpn: z.array(z.string().min(1).max(16)).max(8).optional(),
    allowInsecure: z.boolean().optional(),
    securityLayer: SecurityLayerEnum.optional(),
    disableForFormats: z.array(FormatEnum).optional(),
  });

export const ReorderHostsSchema = z.object({
  // Ordered list of host IDs. Service rewrites their `priority` to match
  // index in the array. Hosts outside the list are left untouched.
  hostIds: z.array(z.uuid()).min(1).max(64),
});

export type CreateHostInput = z.infer<typeof CreateHostSchema>;
export type UpdateHostInput = z.infer<typeof UpdateHostSchema>;
export type ReorderHostsInput = z.infer<typeof ReorderHostsSchema>;
export type ListHostsQuery = z.infer<typeof ListHostsQuerySchema>;
