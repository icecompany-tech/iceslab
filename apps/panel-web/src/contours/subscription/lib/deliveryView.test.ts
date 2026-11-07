import { describe, expect, it } from 'vitest';
import { activeCountOf, previewView } from '@/contours/subscription/lib/deliveryView';

describe('activeCountOf (A-233)', () => {
  it('a number the server gave is the count, zero included', () => {
    expect(activeCountOf({ subscriptionActiveCount: 12 })).toBe(12);
    expect(activeCountOf({ subscriptionActiveCount: 0 })).toBe(0);
  });

  it('no field, no settings or a value that is not a count: unknown, never «nobody»', () => {
    expect(activeCountOf({})).toBeNull();
    expect(activeCountOf(undefined)).toBeNull();
    expect(activeCountOf({ subscriptionActiveCount: '5' })).toBeNull();
    expect(activeCountOf({ subscriptionActiveCount: -1 })).toBeNull();
  });
});

describe('previewView (A-233)', () => {
  it('a link is ready; on its way is loading', () => {
    expect(previewView({ data: { url: 'http://x/sub/preview' }, isError: false })).toBe('ready');
    expect(previewView({ data: undefined, isError: false })).toBe('loading');
  });

  it('a failed request or an answer without a link is failed, not «Loading…» forever', () => {
    expect(previewView({ data: undefined, isError: true })).toBe('failed');
    expect(previewView({ data: {}, isError: false })).toBe('failed');
    expect(previewView({ data: { url: '' }, isError: false })).toBe('failed');
  });
});
