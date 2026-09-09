import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildWebhookBody, signWebhook } from './webhook.js';

describe('webhook signing (K2)', () => {
  it('signs HMAC-SHA256 over `${timestamp}.${body}` deterministically', () => {
    const sig = signWebhook('{"a":1}', 1700000000000, 's3cr3t');
    const expected = createHmac('sha256', 's3cr3t')
      .update('1700000000000.{"a":1}')
      .digest('hex');
    expect(sig).toBe(expected);
    // Stable across calls (no randomness).
    expect(signWebhook('{"a":1}', 1700000000000, 's3cr3t')).toBe(sig);
  });

  it('changes when body, timestamp, or secret changes', () => {
    const base = signWebhook('{"a":1}', 1, 'k');
    expect(signWebhook('{"a":2}', 1, 'k')).not.toBe(base);
    expect(signWebhook('{"a":1}', 2, 'k')).not.toBe(base);
    expect(signWebhook('{"a":1}', 1, 'k2')).not.toBe(base);
  });
});

describe('buildWebhookBody (K2)', () => {
  it('wraps the event + timestamp + data', () => {
    const body = buildWebhookBody('user.created', { userId: 'u1' }, 42);
    expect(JSON.parse(body)).toEqual({
      event: 'user.created',
      timestamp: 42,
      data: { userId: 'u1' },
    });
  });

  it('serialises bigint payloads as decimal strings (no throw)', () => {
    const body = buildWebhookBody(
      'user.traffic-reset',
      { userId: 'u1', previousUsedBytes: 1099511627776n },
      7,
    );
    expect(JSON.parse(body).data).toEqual({
      userId: 'u1',
      previousUsedBytes: '1099511627776',
    });
  });
});
