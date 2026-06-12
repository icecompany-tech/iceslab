import { describe, expect, it } from 'vitest';
import { formatNearLimitsDigest } from './users.cron.js';

describe('formatNearLimitsDigest (K3-tail)', () => {
  it('returns null when there is nothing to report', () => {
    expect(formatNearLimitsDigest([], [])).toBeNull();
  });

  it('lists expiring users with ISO dates', () => {
    const msg = formatNearLimitsDigest(
      [{ username: 'alice', expireAt: new Date('2026-06-15T12:00:00Z') }],
      [],
    );
    expect(msg).toContain('Expiring soon');
    expect(msg).toContain('alice: 2026-06-15');
  });

  it('lists near-cap users with percent', () => {
    const msg = formatNearLimitsDigest([], [{ username: 'bob', pct: 95 }]);
    expect(msg).toContain('Near traffic cap');
    expect(msg).toContain('bob: 95%');
  });

  it('escapes markdown metacharacters in usernames', () => {
    const msg = formatNearLimitsDigest([], [{ username: 'a_b*c', pct: 90 }]);
    expect(msg).toContain('a\\_b\\*c: 90%');
  });

  it('combines both sections when both are present', () => {
    const msg = formatNearLimitsDigest(
      [{ username: 'a', expireAt: null }],
      [{ username: 'b', pct: 91 }],
    );
    expect(msg).toContain('Expiring soon');
    expect(msg).toContain('Near traffic cap');
    expect(msg).toContain('a: ?'); // null expiry renders '?'
  });
});
