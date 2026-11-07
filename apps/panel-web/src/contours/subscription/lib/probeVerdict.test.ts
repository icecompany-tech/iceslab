import { describe, expect, it } from 'vitest';
import { probeVerdict } from '@/contours/subscription/lib/probeVerdict';

describe('probeVerdict (A-137)', () => {
  it('ok only from the server: the route itself answered', () => {
    expect(probeVerdict({ ok: true, status: 404 })).toBe('ok');
  });

  it('an answer that is not the route is its own red, not «unreachable»', () => {
    for (const status of [200, 302, 404, 502]) {
      expect(probeVerdict({ ok: false, status })).toBe('notRoute');
    }
  });

  it('no answer at all: unreachable', () => {
    expect(probeVerdict({ ok: false, status: 0 })).toBe('unreachable');
  });
});
