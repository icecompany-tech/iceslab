import { describe, it, expect } from 'vitest';
import { buildSubscriptionPage, type SubscriptionPageData } from './page.js';

function base(overrides: Partial<SubscriptionPageData> = {}): SubscriptionPageData {
  return {
    brandTitle: 'Iceslab',
    lang: 'en',
    subUrl: 'https://panel.example.com/sub/abc123',
    supportUrl: null,
    user: {
      username: 'alice',
      status: 'active',
      expireAt: null,
      trafficLimitBytes: null,
      trafficUsedBytes: 0,
    },
    protocols: ['hysteria'],
    ...overrides,
  };
}

describe('buildSubscriptionPage', () => {
  it('renders an HTML document with the subscription URL', () => {
    const html = buildSubscriptionPage(base());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('https://panel.example.com/sub/abc123');
    expect(html).toContain('alice');
  });

  it('shows the AmneziaWG .conf download only when an awg endpoint exists', () => {
    const without = buildSubscriptionPage(base({ protocols: ['hysteria'] }));
    expect(without).not.toContain('format=wgconf');

    const withAwg = buildSubscriptionPage(base({ protocols: ['hysteria', 'amneziawg'] }));
    expect(withAwg).toContain('format=wgconf');
  });

  it('always offers the generic proxy format downloads', () => {
    const html = buildSubscriptionPage(base());
    for (const f of ['format=clash', 'format=singbox', 'format=xrayjson', 'format=plain']) {
      expect(html).toContain(f);
    }
  });

  it('HTML-escapes admin/user-controlled fields (XSS defence)', () => {
    const html = buildSubscriptionPage(
      base({
        brandTitle: '<script>alert(1)</script>',
        user: {
          username: '"><img src=x onerror=alert(1)>',
          status: 'active',
          expireAt: null,
          trafficLimitBytes: null,
          trafficUsedBytes: 0,
        },
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a traffic bar only when a limit is set', () => {
    const unlimited = buildSubscriptionPage(base({ user: { ...base().user, trafficLimitBytes: null } }));
    expect(unlimited).not.toContain('class="bar"');

    const limited = buildSubscriptionPage(
      base({
        user: { ...base().user, trafficLimitBytes: 100 * 1024 * 1024 * 1024, trafficUsedBytes: 25 * 1024 * 1024 * 1024 },
      }),
    );
    expect(limited).toContain('class="bar"');
    expect(limited).toContain('width:25%');
  });

  it('localizes labels by lang', () => {
    expect(buildSubscriptionPage(base({ lang: 'en' }))).toContain('Subscription link');
    expect(buildSubscriptionPage(base({ lang: 'ru' }))).toContain('Ссылка подписки');
  });

  it('emits a support link only when supportUrl is set', () => {
    expect(buildSubscriptionPage(base({ supportUrl: null }))).not.toContain('class="support"');
    expect(buildSubscriptionPage(base({ supportUrl: 'https://t.me/support' }))).toContain(
      'https://t.me/support',
    );
  });

  it('renders the scan card only when at least one QR SVG is provided', () => {
    expect(buildSubscriptionPage(base())).not.toContain('class="qrs"');
    const withQr = buildSubscriptionPage(base({ subUrlQrSvg: '<svg id="sub"></svg>' }));
    expect(withQr).toContain('class="qrs"');
    // QR SVG markup is embedded raw (trusted, server-generated), not escaped.
    expect(withQr).toContain('<svg id="sub"></svg>');
  });

  it('shows the AWG QR only when awgQrSvg is provided', () => {
    const both = buildSubscriptionPage(
      base({ subUrlQrSvg: '<svg id="sub"></svg>', awgQrSvg: '<svg id="awg"></svg>' }),
    );
    expect(both).toContain('<svg id="awg"></svg>');
    // The AWG scan hint names the AmneziaWG app (native .conf QR target), not
    // AmneziaVPN (which only scans its own vpn:// keys).
    expect(both).toContain('AmneziaWG');
  });
});
