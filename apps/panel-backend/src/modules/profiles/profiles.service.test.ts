import { describe, expect, it } from 'vitest';
import { CANDIDATE_PORTS, pickFreePort } from './profiles.service.js';

describe('pickFreePort', () => {
  it('returns 443 first on a fresh node', () => {
    expect(pickFreePort([])).toBe(443);
  });

  it('skips taken candidates in preference order', () => {
    expect(pickFreePort([443])).toBe(8443);
    expect(pickFreePort([443, 8443])).toBe(2053);
    expect(pickFreePort([443, 8443, 2053])).toBe(2083);
  });

  it('ignores non-candidate taken ports', () => {
    // A node listening on a random high port still gets 443.
    expect(pickFreePort([51820, 30000])).toBe(443);
  });

  it('scans upward from 20000 when every candidate is taken', () => {
    expect(pickFreePort([...CANDIDATE_PORTS])).toBe(20000);
    expect(pickFreePort([...CANDIDATE_PORTS, 20000, 20001])).toBe(20002);
  });

  it('treats the used list as a set (duplicates are harmless)', () => {
    expect(pickFreePort([443, 443, 443])).toBe(8443);
  });
});
