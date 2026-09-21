import { describe, it, expect } from 'vitest';
import { buildSubscriptionPage, type SubscriptionPageData } from './subscription.page.js';
import { APP_MARK, GLYPHS, createGlyphSheet, isMark } from './subscription.page-icons.js';

/**
 * The glyph set, and the one rule that makes inlining it affordable.
 *
 * This page is opened where a foreign domain will not answer, so every glyph
 * travels in the HTML. Forty-four of them would be tens of kilobytes on every
 * reader, most of it marks for apps that reader was never shown, so the page
 * must carry only what it draws. That is a property of the OUTPUT, not of the
 * table, which is why it is tested here against a rendered page.
 */
function page(overrides: Partial<SubscriptionPageData> = {}): string {
  return buildSubscriptionPage({
    brandTitle: 'Iceslab',
    lang: 'ru',
    subUrl: 'https://panel.example.com/sub/abc123',
    supportUrl: null,
    user: {
      username: 'alice',
      status: 'active',
      expireAt: null,
      trafficLimitBytes: null,
      trafficUsedBytes: 0,
    },
    protocols: ['xray'],
    ...overrides,
  });
}

describe('the glyph set', () => {
  it('keeps the artwork as it was drawn', () => {
    // Every glyph needs its own viewBox, because they are not on one grid: the
    // marks came on 50, Tabler on 24, AmneziaWG on 568. Normalising them would
    // mean redrawing someone else's trademark.
    for (const [key, g] of Object.entries(GLYPHS)) {
      expect(g.box, key).toMatch(/^[\d .-]+$/);
      expect(g.body.length, key).toBeGreaterThan(0);
      // xmlns and a fixed width/height would fight the caller's sizing.
      expect(g.body, key).not.toContain('xmlns');
      expect(g.body, key).not.toMatch(/^<svg/);
    }
  });

  it('gives every brand mark its own opacity, and no service glyph one', () => {
    // 0.12 to 0.30, measured from life: Happ is nearly solid fill, Shadowrocket
    // a thin outline. One constant makes the first shout and the second vanish.
    const inks = Object.values(GLYPHS)
      .map((g) => g.ink)
      .filter((v): v is number => v !== undefined);
    expect(inks.length).toBe(27);
    expect(Math.min(...inks)).toBe(0.12);
    expect(Math.max(...inks)).toBe(0.3);
    expect(isMark('Happ')).toBe(true);
    expect(isMark('Check')).toBe(false);
  });

  it('every app the registry maps to a mark has that mark', () => {
    for (const [app, key] of Object.entries(APP_MARK)) {
      expect(GLYPHS[key], `${app} -> ${key}`).toBeDefined();
      expect(isMark(key), `${app} -> ${key} must be a mark, not a service glyph`).toBe(true);
    }
  });

  it('defines a glyph once however many times it is drawn', () => {
    // The reason the sheet exists. Eight platform panels showing one app used
    // to mean eight copies of its artwork; Streisand alone is 4.4 KB.
    const sheet = createGlyphSheet();
    const a = sheet.draw('Streisand');
    const b = sheet.draw('Streisand');
    expect(a).toBe(b);
    expect(a).not.toContain('<path');
    const sprite = sheet.sprite();
    expect(sprite.split('<symbol').length - 1).toBe(1);
    expect(sprite).toContain(GLYPHS.Streisand.body);
  });

  it('carries the internal id exactly once, so no copy steals another mask', () => {
    // OneXray is the only glyph in the set with an id inside it. The README
    // warns that a second copy on one page breaks the second mask; defining
    // the body once removes the possibility rather than working around it.
    const sheet = createGlyphSheet();
    sheet.draw('OneXray');
    sheet.draw('OneXray');
    const sprite = sheet.sprite();
    expect(sprite.split('id="ic-onexray-hole"').length - 1).toBe(1);
  });

  it('holds nothing before anything is drawn', () => {
    expect(createGlyphSheet().sprite()).toBe('');
    expect(createGlyphSheet().drawn()).toEqual([]);
  });

  it('applies the measured opacity only to the watermark form', () => {
    const sheet = createGlyphSheet();
    // Next to the app's name the mark identifies it, so it is drawn solid.
    expect(sheet.mark('Happ', { cls: 'mrk' })).not.toContain('opacity');
    // Bleeding off the card it is texture, at the opacity measured for Happ.
    expect(sheet.mark('Happ', { watermark: true })).toContain('opacity:0.14');
    expect(sheet.mark('Shadowrocket', { watermark: true })).toContain('opacity:0.28');
    // An app we have no artwork for draws nothing, and says so by returning ''.
    expect(sheet.mark('INCY', { watermark: true })).toBe('');
  });
});

describe('what the page actually carries', () => {
  it('embeds a mark only for the apps it shows', () => {
    const html = page({ protocols: ['xray'] });
    // Shown: Happ has a row on almost every platform.
    expect(html).toContain(GLYPHS.Happ.body.slice(0, 80));
    // Not shown: nothing in the registry maps to these, so they must not be
    // in the output at all. This is the whole point of collecting per render.
    for (const key of ['ClashMi', 'PrizrakBox', 'Loon', 'Stash', 'Husi'] as const) {
      expect(html, key).not.toContain(GLYPHS[key].body.slice(0, 80));
    }
  });

  it('pays for a repeated mark once', () => {
    // Happ stands on seven platform panels. The artwork must appear once and
    // the other six occurrences must be references.
    const html = page({ protocols: ['xray'] });
    const head = GLYPHS.Happ.body.slice(0, 80);
    expect(html.split(head).length - 1).toBe(1);
    expect(html.split('href="#g-Happ"').length - 1).toBeGreaterThan(1);
  });

  it('drops the marks of apps this subscription cannot use', () => {
    // An AmneziaWG-only subscription shows no proxy clients, so none of their
    // marks may travel either: this is the case the weight rule is about.
    const awg = page({ protocols: ['amneziawg'], awgNodes: [{ nodeName: 'de-01' }] });
    expect(awg).not.toContain(GLYPHS.Happ.body.slice(0, 80));
    expect(awg).not.toContain(GLYPHS.Karing.body.slice(0, 80));
    expect(awg).toContain(GLYPHS.AmneziaWG.body.slice(0, 80));
  });

  it('draws no mark at all for an app whose artwork we do not have', () => {
    // INCY, NekoBox, v2rayN and the router entries have no mark in the set. A
    // near-enough mark from another company would be worse than none, so the
    // card is simply a card.
    expect(APP_MARK['OpenWrt']).toBeUndefined();
    expect(APP_MARK['INCY']).toBeUndefined();
    const html = page({ protocols: ['xray'] });
    const router = html.slice(html.indexOf('data-platform="router"'));
    expect(router).toContain('OpenWrt');
    expect(router.slice(0, router.indexOf('</section>'))).not.toContain('app-card__mark');
  });
});
