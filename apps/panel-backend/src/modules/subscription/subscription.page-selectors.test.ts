import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSubscriptionPage, type SubscriptionPageData } from './subscription.page.js';

/**
 * E43, stand 26.09: user adm, three AmneziaWG hosts. Picking "AmneziaWG ·
 * awg-ru-02" in the keys block emptied the install block: its platform button
 * took the server's name, the apps and the steps went. The AmneziaWG server
 * chooser is the platform chooser down to the class (.platform__item), and the
 * platform script collected its rows page-wide, the server rows with them.
 *
 * The page's own script, run in jsdom on the page's own markup.
 */
function page(overrides: Partial<SubscriptionPageData> = {}): Document {
  const html = buildSubscriptionPage({
    brandTitle: 'Iceslab',
    lang: 'en',
    subUrl: 'https://panel.example.com/sub/abc123',
    supportUrl: null,
    user: { username: 'adm', status: 'active', expireAt: null, trafficLimitBytes: null, trafficUsedBytes: 0 },
    protocols: ['xray', 'amneziawg'],
    awgNodes: [
      { nodeName: 'awg-ru-01', vpnKey: 'vpn://one', conf: '[Interface] one' },
      { nodeName: 'awg-ru-02', vpnKey: 'vpn://two', conf: '[Interface] two' },
      { nodeName: 'awg-nl-01', vpnKey: 'vpn://three', conf: '[Interface] three' },
    ],
    ...overrides,
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // An iPhone, as on the stand: the script opens the iOS panel from it.
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  });
  return dom.window.document;
}

const click = (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull();
  el!.dispatchEvent(new el!.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }));
};

/** What the install block shows: the open panel, its app cards, the button. */
function install(doc: Document) {
  const on = doc.querySelector('section.panel.is-on');
  return {
    platform: on?.getAttribute('data-platform') ?? null,
    apps: on ? on.querySelectorAll('.app-card').length : 0,
    button: doc.querySelector('[data-platform-name]')?.textContent ?? null,
  };
}

/** What the keys block shows: the chosen server and the code on screen. */
function keys(doc: Document) {
  return {
    server: doc.querySelector('[data-node-picker] .platform__item.is-on')?.getAttribute('data-target') ?? null,
    label: doc.querySelector('[data-node-name]')?.textContent ?? null,
    figure: doc.querySelector('.qrf.on')?.getAttribute('data-target') ?? null,
  };
}

describe('the AmneziaWG key selector and the platform selector keep their own state', () => {
  it('picking a key leaves the install block as it was', () => {
    const doc = page();
    const before = install(doc);
    expect(before.platform).toBe('ios');
    expect(before.apps).toBeGreaterThan(0);

    click(doc.querySelector('[data-node-picker] .platform__item[data-target="awg:awg-ru-02"]'));

    expect(install(doc)).toEqual(before);
    expect(keys(doc)).toMatchObject({ server: 'awg:awg-ru-02', figure: 'awg:awg-ru-02' });
    expect(keys(doc).label).toContain('awg-ru-02');
    // The platform button never names a server.
    expect(install(doc).button).not.toContain('awg');
  });

  it('picking a platform leaves the chosen key as it was', () => {
    const doc = page();
    click(doc.querySelector('[data-node-picker] .platform__item[data-target="awg:awg-nl-01"]'));
    const chosen = keys(doc);

    const other = [...doc.querySelectorAll('[data-platform-picker] .platform__item')].find(
      (b) => b.getAttribute('data-pick') !== 'ios',
    );
    click(other ?? null);

    const now = install(doc);
    expect(now.platform).toBe(other!.getAttribute('data-pick'));
    expect(now.apps).toBeGreaterThan(0);
    expect(keys(doc)).toEqual(chosen);
  });

  it('the platform menu holds platforms only', () => {
    const doc = page();
    const rows = [...doc.querySelectorAll('[data-platform-picker] .platform__item')];
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.hasAttribute('data-pick')).toBe(true);
      expect(r.hasAttribute('data-target')).toBe(false);
    }
  });
});
