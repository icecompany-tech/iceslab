import { z } from 'zod';

// Max hops in a single cascade. Each hop adds latency + an inter-hop link
// (UFW port LINK_PORT_BASE+i), so the chain is capped. Enforced at the schema
// edge (early 400) AND in validateCascadeHops (defensive), and mirrored in the
// frontend cascade builder (the "Add hop" button stops here). Positions are
// 0..MAX_CASCADE_HOPS-1.
export const MAX_CASCADE_HOPS = 5;

// The full 7-core protocol set. Stored as free strings on the hop; the
// node-agent realises each entry/link cell native-first (xray entry ->
// vless/ss2022/wg links), bridges later. See docs/ROADMAP.md "C. Каскады".
export const CascadeProtocol = z.enum([
  'xray',
  'hysteria',
  'amneziawg',
  'naive',
  'shadowsocks',
  'mtproto',
  'mieru',
]);

export const CascadeHopSchema = z.object({
  nodeId: z.uuid(),
  /** 0 = entry, highest = exit. Must be contiguous 0..N-1 across the cascade. */
  position: z.number().int().min(0).max(MAX_CASCADE_HOPS - 1),
  /** Client-facing protocol; only valid on the entry hop. */
  entryProtocol: CascadeProtocol.optional(),
  /** Protocol to the NEXT hop; omitted on the exit hop. */
  linkProtocol: CascadeProtocol.optional(),
});

export const CreateCascadeSchema = z.object({
  name: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
  hops: z.array(CascadeHopSchema).min(2).max(MAX_CASCADE_HOPS),
});

export const UpdateCascadeSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  hops: z.array(CascadeHopSchema).min(2).max(MAX_CASCADE_HOPS).optional(),
});

export const CascadeIdParamSchema = z.object({ id: z.uuid() });

export type CascadeHopInput = z.infer<typeof CascadeHopSchema>;
export type CreateCascadeInput = z.infer<typeof CreateCascadeSchema>;
export type UpdateCascadeInput = z.infer<typeof UpdateCascadeSchema>;
