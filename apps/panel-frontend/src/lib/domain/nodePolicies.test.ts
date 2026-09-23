import { describe, expect, it } from 'vitest';
import { policyFitRefusal, policyRefusal } from '@/lib/domain/nodePolicies';

const answer = (status: number, data: unknown) => ({ response: { status, data } });

describe('policyFitRefusal: the policy strip on the node page claims one refusal', () => {
  it('POLICY_DOES_NOT_FIT_NODE: the server\'s sentence', () => {
    const r = policyFitRefusal(
      answer(409, { error: 'POLICY_DOES_NOT_FIT_NODE', message: 'Node nl-1 has no WARP, the rule "ads" needs it' }),
    );
    expect(r).toEqual({ code: 'POLICY_DOES_NOT_FIT_NODE', message: 'Node nl-1 has no WARP, the rule "ads" needs it' });
  });

  it('a core-version 400 is not the policy\'s', () => {
    const err = answer(400, {
      error: 'CORE_VERSION_NOT_LISTED',
      message: 'Core versions refused: xray: 26.4.1 is not a listed release (26.3.27)',
      problems: ['xray: 26.4.1 is not a listed release (26.3.27)'],
    });
    expect(policyFitRefusal(err)).toBeNull();
  });

  it('a 500 and a network failure are not the policy\'s', () => {
    expect(policyFitRefusal(answer(500, { error: 'INTERNAL_ERROR', message: 'Internal server error' }))).toBeNull();
    expect(policyFitRefusal(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))).toBeNull();
    expect(policyFitRefusal(null)).toBeNull();
    expect(policyFitRefusal('boom')).toBeNull();
  });
});

describe('policyRefusal: the policy editor keeps every refusal of its own API', () => {
  it('CONFLICT and DIRECTION_IN_USE_BY_POLICY still read, with the policies', () => {
    expect(policyRefusal(answer(409, { error: 'CONFLICT', message: 'Name taken' }))?.code).toBe('CONFLICT');
    expect(
      policyRefusal(answer(409, { error: 'DIRECTION_IN_USE_BY_POLICY', message: 'In use', policies: ['a', 'b'] })),
    ).toEqual({ code: 'DIRECTION_IN_USE_BY_POLICY', message: 'In use', policies: ['a', 'b'] });
  });

  it('no response or no message: nothing', () => {
    expect(policyRefusal(undefined)).toBeNull();
    expect(policyRefusal(answer(400, {}))).toBeNull();
    expect(policyRefusal(answer(400, { message: 5 }))).toBeNull();
  });
});
