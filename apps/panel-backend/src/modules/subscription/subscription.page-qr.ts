import { QRCODEGEN_MIN } from './subscription.page-qrcodegen.js';

/**
 * Codes drawn in the browser, from data the page already carries.
 *
 * Every QR on this page used to be an SVG rendered on the server and embedded:
 * about 5 KB gzip each, three of them on a page with one AmneziaWG node. The
 * encoder is 4.3 KB gzip and is paid once, so the page gets smaller from the
 * second code onward, and the code on the wire is the same code.
 *
 * ⚠ THE PAGE STILL WORKS WITHOUT JAVASCRIPT, and that rule is older than this
 * change (checklist 34: every panel and every config line visible with JS
 * off). A QR is a convenience; the LINK is the substance. So each container
 * carries its text in a data attribute and a readable fallback inside it, and
 * with JS off the reader sees the link and one line telling them why there is
 * no picture. Nothing else on the page depends on this script.
 */

/** Pixels per module below which a code on a screen stops scanning. */
export const QR_PX_PER_MODULE = 3;
/** What every code was drawn at before, and still is when it is small. */
export const QR_MIN_PX = 240;
/** The largest a code gets; the container's width caps it further (CSS). */
export const QR_MAX_PX = 520;

/**
 * How wide to draw a code of `side` modules (quiet zone included).
 *
 * Measured on the stand 2026-09-23: a 934-byte AmneziaVPN vpn:// key is a
 * version-28 code, 129 modules, and at the fixed 240 px that is under 2 px a
 * module, which a phone cannot read off a screen. The ~500-byte .conf (97
 * modules, about 2.4 px) did read. So the size follows the module count: at
 * least QR_PX_PER_MODULE a module, never smaller than before, never larger
 * than QR_MAX_PX, and the container's width caps it on a narrow screen.
 *
 * ⚠ Plain JavaScript with no outside references: the drawer below runs THIS
 * function's source in the browser, so the size the tests check is the size
 * the page draws, not a second copy of the rule.
 */
export function qrSidePx(side: number, perModule: number, minPx: number, maxPx: number): number {
  return Math.min(maxPx, Math.max(minPx, Math.ceil(side * perModule)));
}

/**
 * The drawer: one small pass over the containers the page emitted.
 *
 * Single `<path>` rather than a rect per module, the same shape the server
 * used to emit (`join: true`): a 33x33 code is a thousand rects, and the
 * browser has to lay out every one of them.
 */
const QR_DRAWER = `
(function () {
  var sidePx = ${qrSidePx.toString()};
  var boxes = document.querySelectorAll('[data-qr-text]');
  if (!boxes.length || typeof qrcodegen === 'undefined') return;
  for (var i = 0; i < boxes.length; i++) {
    var box = boxes[i];
    var text = box.getAttribute('data-qr-text');
    if (!text) continue;
    try {
      var qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
      var parts = [];
      for (var y = 0; y < qr.size; y++) {
        for (var x = 0; x < qr.size; x++) {
          if (qr.getModule(x, y)) parts.push('M' + (x + 1) + ',' + (y + 1) + 'h1v1h-1z');
        }
      }
      var side = qr.size + 2;
      var px = sidePx(side, ${QR_PX_PER_MODULE}, ${QR_MIN_PX}, ${QR_MAX_PX});
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + side + ' ' + side + '" ' +
        'width="' + px + '" height="' + px + '" ' +
        'shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="' + side +
        '" height="' + side + '" fill="#fff"/><path d="' + parts.join('') + '" fill="#000"/></svg>';
      box.innerHTML = svg;
      box.removeAttribute('data-qr-pending');
    } catch (e) {
      // A payload too large for a QR, or an encoder that failed: the fallback
      // text stays exactly as the server wrote it. Never leave an empty box.
    }
  }
})();
`;

/** Everything the page needs for its codes: the encoder, then the drawer. */
export const QR_SCRIPT = `${QRCODEGEN_MIN}\n${QR_DRAWER}`;

/**
 * One code's container, with what to show when it cannot be drawn.
 *
 * `fallback` is what a reader with JS off is left holding, and it is the thing
 * that matters: the link itself, or the key. `note` is the one line that says
 * why the picture is missing, so the empty square does not read as a broken
 * page.
 */
export function qrBox(opts: {
  text: string;
  fallback: string;
  note: string;
  cls?: string;
  esc: (s: string) => string;
}): string {
  const { text, fallback, note, esc } = opts;
  return (
    `<div class="${opts.cls ?? 'qbx'}" data-qr-pending data-qr-text="${esc(text)}">` +
    `<div class="qbx__fallback"><code class="qbx__text">${esc(fallback)}</code>` +
    `<span class="qbx__note">${esc(note)}</span></div>` +
    `</div>`
  );
}
