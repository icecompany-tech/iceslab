import { z } from 'zod';
import type { AdminAuditAction, AdminAuditDetails } from '@iceslab/shared';

/**
 * The detail each action may keep, as a closed list of fields (A-267: never a
 * token, key, password, body, config or address). strict(): a field nobody
 * listed is a refusal, not a pass-through, so a route that starts handing
 * over more than its summary is caught here and not in a year's rows.
 */
const counts = z.strictObject({ directions: z.number().int().min(0), nodes: z.number().int().min(0) });
const policyCounts = z.strictObject({ rules: z.number().int().min(0), nodes: z.number().int().min(0) });
const policyRef = z.strictObject({ policyId: z.uuid(), policyLabel: z.string().max(128) });
const scopes = z.strictObject({ scopes: z.array(z.string().max(64)).max(32) });
const count = z.number().int().min(0);

export const AUDIT_DETAIL_SCHEMAS = {
  'auth.login': z.union([
    z.strictObject({ twoFactor: z.boolean(), locked: z.literal(true).optional() }),
    // A-288: the refusals past the cap of their hour, counted.
    z.strictObject({ suppressed: z.number().int().min(1), windowStart: z.iso.datetime() }),
  ]),
  'admin.register': z.null(),
  'admin.password.change': z.null(),
  'admin.2fa.enable': z.null(),
  'admin.2fa.disable': z.null(),
  'apiToken.create': scopes,
  'apiToken.revoke': scopes,
  'settings.update': z.strictObject({ changed: z.array(z.string().max(64)).max(64) }),
  'users.bulk': z.strictObject({
    action: z.enum(['extend', 'reset-traffic', 'revoke', 'delete', 'enable', 'disable']),
    requested: count,
    succeeded: count,
    failed: count,
    expireDays: count.optional(),
    // MAX_BULK_USERS (users.schemas.ts) is 500; ids as the route takes them
    // (PermissiveUuid), so the shape only.
    userIds: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).max(500),
  }),
  'user.delete': z.strictObject({ erasedAfter: z.iso.datetime() }),
  'user.credentials.reissue': z.null(),
  'node.connLog.clear': z.strictObject({
    outcome: z
      .array(
        z.strictObject({
          source: z.enum(['journal', 'syslog']),
          state: z.enum(['cleared', 'absent', 'failed']),
        }),
      )
      .max(8),
  }),
  'node.cert.rotate': z.strictObject({ notAfter: z.iso.datetime() }),
  'cascade.create': counts,
  'cascade.update': counts,
  'cascade.delete': counts,
  'cascade.enable': counts,
  'cascade.disable': counts,
  'nodePolicy.create': policyCounts,
  'nodePolicy.update': policyCounts,
  'nodePolicy.delete': policyCounts,
  'nodePolicy.attach': policyRef,
  'nodePolicy.detach': policyRef,
} satisfies { [A in AdminAuditAction]: z.ZodType<AdminAuditDetails[A]> };

/** Key names a detail never carries, whatever a schema above comes to say.
 *  `ip` as a word of a camelCase or snake name, not as letters: `description`
 *  is fine, `clientIp` and `ip_addr` are not. */
const FORBIDDEN_WORD = /token|password|passwd|secret|key|address|body|config|pem/i;
const IP_WORD = /(^|_)ip($|_|[A-Z])|[a-z]Ip($|_|[A-Z])|^IP/;
export const isForbiddenDetailKey = (k: string) => FORBIDDEN_WORD.test(k) || IP_WORD.test(k);

/** Every key name in a value, at any depth. */
export function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  }
  return [];
}

/**
 * The detail as it will be written, or null with the reason it was dropped.
 * Never throws: the action has already happened, and a summary that does not
 * fit costs the summary, not the row.
 */
export function checkDetail(
  action: AdminAuditAction,
  detail: unknown,
): { detail: AdminAuditDetails[AdminAuditAction] | null; dropped?: string } {
  if (detail === null || detail === undefined) return { detail: null };
  const parsed = AUDIT_DETAIL_SCHEMAS[action].safeParse(detail);
  if (!parsed.success) return { detail: null, dropped: 'schema' };
  const bad = keysOf(parsed.data).find(isForbiddenDetailKey);
  if (bad) return { detail: null, dropped: `key ${bad}` };
  return { detail: parsed.data };
}
