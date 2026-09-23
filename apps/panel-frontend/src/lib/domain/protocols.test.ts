import { describe, expect, it } from 'vitest';
import { isOlderThan, MIN_CASCADE_CORE } from '@/lib/domain/protocols';

// The cascade gate after the switch to the contract's comparison: the same
// threshold must give the same answers it gave with the old local one.
describe('isOlderThan against MIN_CASCADE_CORE', () => {
  it('25.9.4 is older, 25.9.5 is not, 26.3.27 is not', () => {
    expect(MIN_CASCADE_CORE).toBe('25.9.5');
    expect(isOlderThan('25.9.4', MIN_CASCADE_CORE)).toBe(true);
    expect(isOlderThan('25.9.5', MIN_CASCADE_CORE)).toBe(false);
    expect(isOlderThan('26.3.27', MIN_CASCADE_CORE)).toBe(false);
  });

  it('numbers, not strings: 25.10.1 is newer than 25.9.5; a leading v is read', () => {
    expect(isOlderThan('25.10.1', MIN_CASCADE_CORE)).toBe(false);
    expect(isOlderThan('v25.9.4', MIN_CASCADE_CORE)).toBe(true);
  });

  it('no version, or an order the contract cannot decide, is never "older"', () => {
    expect(isOlderThan(null, MIN_CASCADE_CORE)).toBe(false);
    expect(isOlderThan(undefined, MIN_CASCADE_CORE)).toBe(false);
    expect(isOlderThan('', MIN_CASCADE_CORE)).toBe(false);
    expect(isOlderThan('dev-build', MIN_CASCADE_CORE)).toBe(false);
    expect(isOlderThan('25.9.5-2', MIN_CASCADE_CORE)).toBe(false);
  });
});
