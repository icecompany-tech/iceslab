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

  it('shows a per-node AmneziaWG .conf download only when an awg node exists', () => {
    const without = buildSubscriptionPage(base({ protocols: ['hysteria'] }));
    expect(without).not.toContain('format=wgconf');

    const withAwg = buildSubscriptionPage(
      base({ protocols: ['hysteria', 'amneziawg'], awgNodes: [{ nodeName: 'awg' }] }),
    );
    // .conf download is pinned to the node with &node=.
    expect(withAwg).toContain('format=wgconf&node=awg');
  });

  it('multi-node: a server selector + one QR per (node, app), not a stacked tower', () => {
    const html = buildSubscriptionPage(
      base({
        protocols: ['amneziawg'],
        awgNodes: [
          { nodeName: 'awg', vpnQrSvg: '<svg id="vpn-nl"></svg>', confQrSvg: '<svg id="conf-nl"></svg>' },
          { nodeName: 'awg-de', vpnQrSvg: '<svg id="vpn-de"></svg>', confQrSvg: '<svg id="conf-de"></svg>' },
        ],
      }),
    );
    // every node's QRs are embedded (shown/hidden client-side)...
    for (const id of ['vpn-nl', 'conf-nl', 'vpn-de', 'conf-de']) {
      expect(html).toContain(`<svg id="${id}"></svg>`);
    }
    // ...behind a per-node server selector...
    expect(html).toContain('class="segs tgsel"');
    expect(html).toContain('data-target="awg:awg"');
    expect(html).toContain('data-target="awg:awg-de"');
    // ...and an AmneziaVPN / AmneziaWG app toggle.
    expect(html).toContain('data-app="vpn"');
    expect(html).toContain('data-app="conf"');
    // figures are keyed by (node, app) so the script can swap them in place.
    expect(html).toContain('data-target="awg:awg-de" data-app="vpn"');
    expect(html).toContain('data-target="awg:awg-de" data-app="conf"');
    // per-node .conf download still offered in the downloads card.
    expect(html).toContain('format=wgconf&node=awg-de');
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

  it('renders an in-page RU/EN selector marking the active locale', () => {
    const en = buildSubscriptionPage(base({ lang: 'en' }));
    // both links present (server-side re-render via ?lang=, no JS)
    expect(en).toContain('href="?lang=ru"');
    expect(en).toContain('href="?lang=en"');
    // active locale is the filled one
    expect(en).toContain('class="lng on" href="?lang=en"');
    expect(en).not.toContain('class="lng on" href="?lang=ru"');

    const ru = buildSubscriptionPage(base({ lang: 'ru' }));
    expect(ru).toContain('class="lng on" href="?lang=ru"');
    expect(ru).not.toContain('class="lng on" href="?lang=en"');
  });

  it('emits a support link only when supportUrl is set', () => {
    expect(buildSubscriptionPage(base({ supportUrl: null }))).not.toContain('class="support"');
    expect(buildSubscriptionPage(base({ supportUrl: 'https://t.me/support' }))).toContain(
      'https://t.me/support',
    );
  });

  it('renders the scan card only when at least one QR is provided', () => {
    expect(buildSubscriptionPage(base())).not.toContain('class="qrview"');
    // proxy protocol + a subscription QR → the QR is a selectable target
    const withQr = buildSubscriptionPage(base({ subUrlQrSvg: '<svg id="sub"></svg>' }));
    expect(withQr).toContain('class="qrview"');
    // QR SVG markup is embedded raw (trusted, server-generated), not escaped.
    expect(withQr).toContain('<svg id="sub"></svg>');
  });

  it('single AWG node: no server selector, caption is just the app name', () => {
    const html = buildSubscriptionPage(
      base({ protocols: ['amneziawg'], awgNodes: [{ nodeName: 'awg', vpnQrSvg: '<svg id="vpn"></svg>' }] }),
    );
    expect(html).toContain('<svg id="vpn"></svg>');
    // figure caption is the app name, never a "· awg" node suffix (the node
    // lives in the selector now)
    expect(html).toContain('<figcaption>AmneziaVPN</figcaption>');
    expect(html).not.toContain('· awg');
    // a single target → no server selector segment
    expect(html).not.toContain('class="segs tgsel"');
  });
});
