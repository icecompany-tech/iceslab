import { describe, expect, it } from 'vitest';
import { coreVersionOf } from '@/lib/domain/coreVersion';

describe('coreVersionOf', () => {
  it('1. the core reported a version: its own, as reported', () => {
    expect(coreVersionOf({ version: '1.13.14', installed: true })).toBe('1.13.14');
    expect(coreVersionOf({ version: '1.0.20260611' })).toBe('1.0.20260611');
  });

  it('2. empty or no version: the row says nothing', () => {
    expect(coreVersionOf({ version: '' })).toBeNull();
    expect(coreVersionOf({ version: '   ' })).toBeNull();
    expect(coreVersionOf({})).toBeNull();
  });

  it('3. the binary is missing: no version, even if one was sent', () => {
    expect(coreVersionOf({ version: '2.12.3', installed: false })).toBeNull();
    expect(coreVersionOf({ installed: false })).toBeNull();
  });
});
