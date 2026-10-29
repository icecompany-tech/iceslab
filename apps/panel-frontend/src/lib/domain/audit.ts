import type { AdminAuditListResponse, AdminAuditTargetKind } from '@iceslab/shared';
import { api } from '@/lib/net/client';

/**
 * The admin audit log, GET /api/audit (contract in shared/audit.ts). Admins
 * only: any API token is refused with 403 AUDIT_ADMIN_ONLY. Pages go by an
 * opaque cursor; a cursor the server cannot read is 400 BAD_CURSOR.
 */
export interface AuditQuery {
  /** A full action ('user.delete') or a group, a prefix ending in a dot ('cascade.'). */
  action?: string;
  targetKind?: AdminAuditTargetKind;
  /** ISO datetime, inclusive. */
  from?: string;
  cursor?: string;
  limit?: number;
}

export async function listAudit(q: AuditQuery): Promise<AdminAuditListResponse> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params[k] = v;
  const { data } = await api.get<AdminAuditListResponse>('/api/audit', { params });
  return data;
}

export type AuditRefusal = 'AUDIT_ADMIN_ONLY' | 'BAD_CURSOR';

/** The two refusals of GET /api/audit the screen says in its own words. The
 *  input is checked first; null = not one of them. */
export function auditRefusal(err: unknown): AuditRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || !res.data || typeof res.data !== 'object') return null;
  const code = (res.data as { error?: unknown }).error;
  if (res.status === 403 && code === 'AUDIT_ADMIN_ONLY') return code;
  if (res.status === 400 && code === 'BAD_CURSOR') return code;
  return null;
}
