import { describe, expect, it } from 'vitest';
import { subscriptionOrigin } from './config.js';

// An operator can serve /sub from its own domain so a block takes only the
// user-facing half down, leaving the admin API and node bootstrap alive. The
// value of that split collapses if any producer of a subscription link keeps
// using the panel domain, so the rule lives in one function and is pinned here.

describe('subscriptionOrigin', () => {
  it('falls back to the panel origin when no split domain is configured', () => {
    expect(subscriptionOrigin({ PUBLIC_URL: 'https://panel.example.com' })).toBe(
      'https://panel.example.com',
    );
  });

  it('prefers the subscription domain once the operator sets one', () => {
    expect(
      subscriptionOrigin({
        PUBLIC_URL: 'https://panel.example.com',
        SUBSCRIPTION_PUBLIC_URL: 'https://sub.example.com',
      }),
    ).toBe('https://sub.example.com');
  });

  it('strips a trailing slash from either source', () => {
    // Concatenation sites append SUBSCRIPTION_PATH_PREFIX, which already starts
    // with `/`. An operator who pastes their domain with the slash they see in
    // the browser would otherwise get https://sub.example.com//sub/<token>.
    expect(
      subscriptionOrigin({
        PUBLIC_URL: 'https://panel.example.com/',
        SUBSCRIPTION_PUBLIC_URL: 'https://sub.example.com/',
      }),
    ).toBe('https://sub.example.com');
    expect(subscriptionOrigin({ PUBLIC_URL: 'https://panel.example.com/' })).toBe(
      'https://panel.example.com',
    );
  });

  it('treats an explicitly undefined split domain as unset', () => {
    // The env var is optional, so a parsed config carries the key with an
    // undefined value rather than omitting it. `??` must not read that as a
    // deliberate empty origin.
    expect(
      subscriptionOrigin({
        PUBLIC_URL: 'https://panel.example.com',
        SUBSCRIPTION_PUBLIC_URL: undefined,
      }),
    ).toBe('https://panel.example.com');
  });
});
