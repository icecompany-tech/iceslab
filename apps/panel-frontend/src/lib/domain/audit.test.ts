import { describe, expect, it } from 'vitest';
import { auditRefusal } from '@/lib/domain/audit';

const res = (status: number, data: unknown) => ({ response: { status, data } });

describe('auditRefusal', () => {
  it('403 AUDIT_ADMIN_ONLY и 400 BAD_CURSOR', () => {
    expect(auditRefusal(res(403, { error: 'AUDIT_ADMIN_ONLY' }))).toBe('AUDIT_ADMIN_ONLY');
    expect(auditRefusal(res(400, { error: 'BAD_CURSOR', message: 'm' }))).toBe('BAD_CURSOR');
  });
  it('другой код или статус, кривой вход: не они', () => {
    expect(auditRefusal(res(400, { error: 'AUDIT_ADMIN_ONLY' }))).toBeNull();
    expect(auditRefusal(res(403, { error: 'FORBIDDEN' }))).toBeNull();
    expect(auditRefusal(res(400, { error: 'VALIDATION_ERROR' }))).toBeNull();
    for (const e of [null, undefined, 'x', {}, { response: null }, res(403, null)]) expect(auditRefusal(e)).toBeNull();
  });
});
