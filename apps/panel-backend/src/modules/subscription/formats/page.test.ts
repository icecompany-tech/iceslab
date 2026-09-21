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

  it('offers Happ and v2RayTun with a working one-tap import', () => {
    // These two are what the operator's own subscribers run, and the page
    // listed neither: the most common reader was told to copy a link by hand
    // while every other client got a button. Schemes verified 2026-09-11
    // against docs.v2raytun.com/deep-link and the Happ-family deep-link docs.
    const html = buildSubscriptionPage(base({ protocols: ['xray'] }));
    expect(html).toContain('Happ');
    expect(html).toContain('happ://add/https://panel.example.com/sub/abc123');
    expect(html).toContain('v2RayTun');
    expect(html).toContain('v2raytun://import/https://panel.example.com/sub/abc123');
  });

  it('does not offer them to an AmneziaWG-only subscription', () => {
    // Neither speaks AWG obfuscation, so a button there would open an app that
    // cannot use the config, which is worse than no button.
    const html = buildSubscriptionPage(base({ protocols: ['amneziawg'] }));
    expect(html).not.toContain('happ://add/');
    expect(html).not.toContain('v2raytun://import/');
  });

  it('shows a per-node AmneziaWG .conf download only when an awg node exists', () => {
    const without = buildSubscriptionPage(base({ protocols: ['hysteria'] }));
    expect(without).not.toContain('format=wgconf');

    const withAwg = buildSubscriptionPage(
      base({ protocols: ['hysteria', 'amneziawg'], awgNodes: [{ nodeName: 'awg' }] }),
    );
    // .conf download is pinned to the node with &node=, and the ampersand is
    // written as an entity now, which is what an href should carry.
    expect(withAwg).toContain('format=wgconf&amp;node=awg');
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
    expect(html).toContain('format=wgconf&amp;node=awg-de');
  });

  it('gives Android TV exactly three apps, and these three', () => {
    // The one test worth more than the rest of this file. Three clients cover
    // a television honestly: Happ, Karing, INCY. Everything else either has no
    // Android TV build or installs and then cannot be driven with a remote,
    // and both of those were in the registry as recently as this week. This
    // fails the day somebody "fixes" the registry from memory.
    const html = buildSubscriptionPage(base({ protocols: ['xray', 'shadowsocks', 'hysteria'] }));
    const panel = html.slice(html.indexOf('data-platform="androidtv"'));
    const body = panel.slice(0, panel.indexOf('</section>'));
    const names = [...body.matchAll(/class="app-card__name">([^<]+)</g)].map((m) => m[1]);
    expect(names).toEqual(['Happ', 'Karing', 'INCY']);
    // And it says so out loud, because a short list reads like a sample.
    expect(body).toContain('whole list');
  });

  it('hides a platform that has nothing to offer instead of showing an empty one', () => {
    // An AmneziaWG-only subscription has no client for a television at all:
    // AmneziaVPN does not build for one. The platform leaves the selector.
    const html = buildSubscriptionPage(
      base({ protocols: ['amneziawg'], awgNodes: [{ nodeName: 'de-01' }] }),
    );
    expect(html).not.toContain('data-pick="androidtv"');
    expect(html).not.toContain('data-platform="androidtv"');
    // The ones that do have a client are still there.
    expect(html).toContain('data-pick="android"');
  });

  it('offers the Telegram row only where the proxy exists and the app has the field', () => {
    // Two conditions, and neither is cosmetic: Telegram on a television and on
    // a router does not exist, the web client has no proxy settings at all,
    // and a subscription without an MTProto endpoint has no telegram proxy to
    // configure in the first place.
    const withTg = buildSubscriptionPage(base({ protocols: ['xray', 'mtproto'] }));
    const panelOf = (html: string, p: string) => {
      const from = html.slice(html.indexOf(`data-platform="${p}"`));
      return from.slice(0, from.indexOf('</section>'));
    };
    for (const p of ['ios', 'android', 'windows', 'macos', 'linux']) {
      expect(panelOf(withTg, p), p).toContain('class="tg-row"');
    }
    for (const p of ['androidtv', 'appletv']) {
      expect(panelOf(withTg, p), p).not.toContain('class="tg-row"');
    }
    // No MTProto in the subscription, no row anywhere.
    expect(buildSubscriptionPage(base({ protocols: ['xray'] }))).not.toContain('class="tg-row"');
  });

  it('splits the apps into the ones that just work and the ones that do not', () => {
    const html = buildSubscriptionPage(base({ protocols: ['xray', 'shadowsocks', 'hysteria'] }));
    const from = html.slice(html.indexOf('data-platform="windows"'));
    const panel = from.slice(0, from.indexOf('</section>'));
    expect(panel).toContain('INSTALL AND IT WORKS');
    expect(panel).toContain('FOR FINE CONTROL, HARDER');
    // v2rayN is a routing console and must never be in the row above the fold:
    // it is the wrong answer to "what do I install".
    const row = panel.slice(0, panel.indexOf('all-apps'));
    expect(row).not.toContain('v2rayN');
    expect(row).toContain('Happ');
  });

  it('names what each download format is for, and never prints the config itself', () => {
    const html = buildSubscriptionPage(base({ protocols: ['xray', 'shadowsocks'] }));
    expect(html).toContain('Clash-compatible');
    // Grouped by purpose. A router file must stay reachable from a laptop:
    // taking a config file is what people do FOR another device.
    expect(html).toContain('data-dl-group="router"');
    expect(html).toContain('data-dl-group="clients"');
    // The download flag is separate from the format, and `plain` never gets it.
    expect(html).toContain('format=clash&amp;dl=1');
    expect(html).not.toContain('format=plain&amp;dl=1');
    // The one place a secret would stop being hidden behind the token.
    expect(html).toContain('plain text');
  });

  it('leaves out a format that would come back empty', () => {
    // Outline is Shadowsocks-only; offering it to a subscription without any
    // is the same defect as naming an app that does not exist on the platform.
    expect(buildSubscriptionPage(base({ protocols: ['xray'] }))).not.toContain('format=outline');
    expect(buildSubscriptionPage(base({ protocols: ['xray', 'shadowsocks'] }))).toContain(
      'format=outline',
    );
  });

  it('warns before the traffic runs out, and says what actually happens then', () => {
    // "Speed will drop" would be a lie here: the limit flips the user to
    // `limited` and the subscription stops answering (subscription.service.ts).
    const gib = 1024 * 1024 * 1024;
    const html = buildSubscriptionPage(
      base({
        lang: 'ru',
        user: { ...base().user, trafficLimitBytes: 200 * gib, trafficUsedBytes: 196 * gib },
      }),
    );
    expect(html).toContain('Осталось 4.0 GiB из 200 GiB');
    expect(html).toContain('доступ остановится');
    expect(html).toContain('tile--warn');
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

  it('states the traffic as a figure, with or without a limit', () => {
    // The progress bar is gone on purpose: the card is four tiles now, and a
    // bar that is 25% full says less than "25 / 100 GiB" in the same space.
    const unlimited = buildSubscriptionPage(base({ user: { ...base().user, trafficLimitBytes: null } }));
    expect(unlimited).not.toContain('class="bar"');
    expect(unlimited).toContain('unlimited');

    const limited = buildSubscriptionPage(
      base({
        user: { ...base().user, trafficLimitBytes: 100 * 1024 * 1024 * 1024, trafficUsedBytes: 25 * 1024 * 1024 * 1024 },
      }),
    );
    expect(limited).toContain('25.0 GiB / 100 GiB');
  });

  it('localizes labels by lang', () => {
    expect(buildSubscriptionPage(base({ lang: 'en' }))).toContain('Subscription link');
    expect(buildSubscriptionPage(base({ lang: 'ru' }))).toContain('Ссылка подписки');
  });

  it('prints the date the way a person writes it, in their language', () => {
    // It used to print toISOString().slice(0,10). 2026-12-10 is a machine's
    // date: half the world reads it as the tenth of December and the other
    // half reads nothing at all.
    const at = '2026-12-10T00:00:00.000Z';
    expect(buildSubscriptionPage(base({ lang: 'ru', user: { ...base().user, expireAt: at } })))
      // Genitive, which is what makes it Russian rather than translated.
      .toContain('10 декабря, 2026');
    expect(buildSubscriptionPage(base({ lang: 'en', user: { ...base().user, expireAt: at } })))
      .toContain('December 10, 2026');
  });

  it('counts the days left, and counts them in Russian', () => {
    // Three forms, and the wrong one is the loudest sign a page was written
    // somewhere else. The dates are far enough out to stay in the plain state.
    const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
    expect(buildSubscriptionPage(base({ lang: 'ru', user: { ...base().user, expireAt: days(82) } })))
      .toContain('осталось 82 дня');
    expect(buildSubscriptionPage(base({ lang: 'ru', user: { ...base().user, expireAt: days(21) } })))
      .toContain('осталось 21 день');
    expect(buildSubscriptionPage(base({ lang: 'ru', user: { ...base().user, expireAt: days(15) } })))
      .toContain('осталось 15 дней');
    expect(buildSubscriptionPage(base({ lang: 'en', user: { ...base().user, expireAt: days(82) } })))
      .toContain('82 days left');
    // No date at all is its own sentence, not "0 days".
    expect(buildSubscriptionPage(base({ lang: 'ru', user: { ...base().user, expireAt: null } })))
      .toContain('без срока');
  });

  it('turns amber in the last week, while the subscription still works', () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    const html = buildSubscriptionPage(base({ lang: 'ru', user: { ...base().user, expireAt: soon } }));
    expect(html).toContain('Истекает через 3 дня');
    expect(html).toContain('sub-card__badge--warn');
    expect(html).toContain('tile--warn');
    // The status itself is still green: it works, and that is the difference
    // between a warning and a refusal.
    expect(html).toContain('tile--ok');
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

  it('puts the subscription QR in the transfer window, and only there', () => {
    // It used to sit in the scan card as well. One QR svg is 25 KB, this page
    // is opened over a link that may barely work, and the same code twice is
    // the most expensive decoration available.
    expect(buildSubscriptionPage(base())).not.toContain('class="overlay" data-transfer');
    const withQr = buildSubscriptionPage(base({ subUrlQrSvg: '<svg id="sub"></svg>' }));
    expect(withQr).toContain('class="overlay" data-transfer');
    // QR SVG markup is embedded raw (trusted, server-generated), not escaped.
    expect(withQr.split('<svg id="sub"></svg>').length - 1).toBe(1);
    // The scan card is now the AmneziaWG widget alone: a proxy-only
    // subscription has nothing to put in it.
    expect(withQr).not.toContain('class="qrview"');
  });

  it('offers the transfer button only where a camera could read the code', () => {
    // A television and a router have no camera, and the code works the other
    // way round there anyway: what is needed is getting the link ONTO the
    // device. The button is in the page header, so the platform switch is what
    // takes it away, and the list it switches on is in the page's own script.
    const html = buildSubscriptionPage(base({ subUrlQrSvg: '<svg id="sub"></svg>' }));
    expect(html).toContain('data-open-transfer');
    expect(html).toContain('var NO_TRANSFER = ["androidtv","appletv","router"]');
  });

  it('single AWG node: no server selector, caption is just the app name', () => {
    const html = buildSubscriptionPage(
      base({ protocols: ['amneziawg'], awgNodes: [{ nodeName: 'awg', vpnQrSvg: '<svg id="vpn"></svg>' }] }),
    );
    expect(html).toContain('<svg id="vpn"></svg>');
    // figure caption is the app name, never a "· awg" node suffix (the node
    // lives in the selector now)
    expect(html).toContain('<figcaption>AmneziaVPN</figcaption>');
    expect(html).not.toContain('<figcaption>AmneziaVPN · awg</figcaption>');
    // a single target → no server selector segment
    expect(html).not.toContain('class="segs tgsel"');
  });
});
