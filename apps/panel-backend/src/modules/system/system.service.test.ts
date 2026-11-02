import { describe, expect, it } from 'vitest';
import { isNewer } from './system.service.js';

describe('isNewer', () => {
  it('detects a newer patch / minor / major', () => {
    expect(isNewer('0.1.5', '0.1.4')).toBe(true);
    expect(isNewer('0.2.0', '0.1.4')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('returns false for an equal or older latest', () => {
    expect(isNewer('0.1.4', '0.1.4')).toBe(false);
    expect(isNewer('0.1.3', '0.1.4')).toBe(false);
    expect(isNewer('0.1.4', '0.2.0')).toBe(false);
  });

  it('ignores a leading v and build metadata', () => {
    expect(isNewer('v0.1.5', '0.1.4')).toBe(true);
    expect(isNewer('v0.1.4', 'v0.1.4')).toBe(false);
    expect(isNewer('0.1.5-rc.1', '0.1.4')).toBe(true);
    expect(isNewer('0.1.4+build.9', '0.1.4')).toBe(false);
    expect(isNewer('0.3.0-rc.1+b.2', '0.3.0-rc.1')).toBe(false);
  });

  // After a final tag develop runs as X.Y.Z+dev and must not be offered the
  // release it was built from.
  it('does not offer the tag to the develop build after it', () => {
    expect(isNewer('v0.3.0', '0.3.0+dev')).toBe(false);
    expect(isNewer('v0.3.1', '0.3.0+dev')).toBe(true);
  });

  // semver 2.0 §11: a panel on a release candidate has to hear of the final.
  it('orders pre-releases as semver 2.0 does', () => {
    expect(isNewer('0.3.0', '0.3.0-rc.1')).toBe(true);
    expect(isNewer('v0.3.0', 'v0.3.0-rc.2')).toBe(true);
    expect(isNewer('0.3.0-rc.1', '0.3.0')).toBe(false);
    expect(isNewer('0.3.0-rc.2', '0.3.0-rc.1')).toBe(true);
    expect(isNewer('0.3.0-rc.1', '0.3.0-rc.2')).toBe(false);
    expect(isNewer('0.3.0-rc.10', '0.3.0-rc.2')).toBe(true);
    expect(isNewer('0.3.0-rc.1', '0.2.1')).toBe(true);
    expect(isNewer('0.2.1', '0.3.0-rc.1')).toBe(false);
    expect(isNewer('0.3.0-rc.1', '0.3.0-rc.1')).toBe(false);
    // The precedence example of the spec, §11.4.
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 1; i < chain.length; i++) {
      expect(isNewer(chain[i]!, chain[i - 1]!), `${chain[i]} > ${chain[i - 1]}`).toBe(true);
      expect(isNewer(chain[i - 1]!, chain[i]!), `${chain[i - 1]} < ${chain[i]}`).toBe(false);
    }
  });

  it('handles differing component counts', () => {
    expect(isNewer('0.2', '0.1.9')).toBe(true);
    expect(isNewer('0.1', '0.1.0')).toBe(false);
  });
});
