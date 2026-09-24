import { describe, expect, it } from 'vitest';
import { entryPolicyPatch, entryPolicyPlace, entryPolicyRefusal } from '@/contours/cascades/lib/cascadeForm';
import { policyEntryOf, routePolicyInUse } from '@/lib/domain/routePolicies';

describe('entryPolicyPlace: где стоит политика входа (Ф9.3)', () => {
  it('hysteria и amneziawg: селектор; xray: подпись; прочее и старый сервер: ничего', () => {
    expect(entryPolicyPlace('hysteria', true)).toBe('select');
    expect(entryPolicyPlace('amneziawg', true)).toBe('select');
    expect(entryPolicyPlace('xray', true)).toBe('xray-self');
    expect(entryPolicyPlace('naive', true)).toBe('hidden');
    expect(entryPolicyPlace('hysteria', false)).toBe('hidden');
    expect(entryPolicyPlace(undefined, true)).toBe('hidden');
  });
});

describe('entryPolicyPatch: PUT только при правке', () => {
  it('не менялась или сервер поля не знает: ключа нет', () => {
    expect(entryPolicyPatch('p1', 'p1')).toEqual({});
    expect(entryPolicyPatch(null, null)).toEqual({});
    expect(entryPolicyPatch(undefined, undefined)).toEqual({});
  });
  it('поставить, сменить, снять', () => {
    expect(entryPolicyPatch('p1', null)).toEqual({ entryPolicyId: 'p1' });
    expect(entryPolicyPatch('p2', 'p1')).toEqual({ entryPolicyId: 'p2' });
    expect(entryPolicyPatch(null, 'p1')).toEqual({ entryPolicyId: null });
  });
});

const res = (data: unknown, status: number) => ({ response: { status, data } });

describe('отказы Ф9.3: вход проверяется первым', () => {
  it('400 ENTRY_POLICY_NOT_FOUND', () => {
    expect(entryPolicyRefusal(res({ error: 'ENTRY_POLICY_NOT_FOUND', policyId: 'p1' }, 400))).toEqual({ policyId: 'p1' });
    for (const e of [null, 'x', res({ error: 'ENTRY_POLICY_NOT_FOUND' }, 409), res({ error: 'INVALID' }, 400)]) {
      expect(entryPolicyRefusal(e)).toBeNull();
    }
  });

  it('409 ROUTE_POLICY_IN_USE называет каскады; кривые записи пропускаются', () => {
    expect(
      routePolicyInUse(res({ error: 'ROUTE_POLICY_IN_USE', cascades: [{ id: 'c1', name: '123' }, { id: 7 }] }, 409)),
    ).toEqual({ cascades: [{ id: 'c1', name: '123' }] });
    for (const e of [null, {}, res({ error: 'CONFLICT' }, 409), res({ error: 'ROUTE_POLICY_IN_USE' }, 400)]) {
      expect(routePolicyInUse(e)).toBeNull();
    }
  });
});

describe('policyEntryOf: у каких каскадов политика стоит входом, по факту списка', () => {
  it('по entryPolicy.id; не стоит нигде: пустой список', () => {
    const cascades = [
      { name: '123', entryPolicy: { id: 'p1' } },
      { name: 'eu', entryPolicy: null },
    ];
    expect(policyEntryOf('p1', cascades)).toEqual(['123']);
    expect(policyEntryOf('p2', cascades)).toEqual([]);
  });
  it('хоть у одного каскада нет ключа или списка нет: не факт', () => {
    expect(policyEntryOf('p1', [{ name: 'a', entryPolicy: { id: 'p1' } }, { name: 'b' }])).toBeNull();
    expect(policyEntryOf('p1', undefined)).toBeNull();
  });
});
