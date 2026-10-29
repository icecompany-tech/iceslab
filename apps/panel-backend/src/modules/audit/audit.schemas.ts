import { z } from 'zod';
import { ADMIN_AUDIT_TARGET_KINDS } from '@iceslab/shared';

/** GET /api/audit. action is a full name ('user.delete') or a prefix ending in
 *  a dot ('cascade.'); from is inclusive, to exclusive. */
export const AuditListQuerySchema = z.object({
  action: z
    .string()
    .max(64)
    .regex(/^[a-zA-Z]+(\.[a-zA-Z]+)*\.?$/)
    .optional(),
  targetKind: z.enum(ADMIN_AUDIT_TARGET_KINDS).optional(),
  targetId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(256).optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
