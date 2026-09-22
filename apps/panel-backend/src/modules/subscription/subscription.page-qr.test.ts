import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import QRCode from 'qrcode-svg';
import { QRCODEGEN_MIN } from './subscription.page-qrcodegen.js';
import { qrBox, QR_SCRIPT } from './subscription.page-qr.js';

/**
 * The vendored encoder against the one it replaces.
 *
 * A QR is either scannable or worthless, and nothing about the page tells the
 * difference: a wrong code renders exactly as prettily as a right one. So the
 * test does not check that the script "looks like" an encoder, it runs it and
 * compares the module grid, cell by cell, with qrcode-svg, which has been
 * drawing the codes people actually scanned since this page existed.
 *
 * That also guards the one realistic accident with a vendored blob: a bad
 * paste, or a refresh from upstream that changes behaviour. Both come out here
 * as a grid that disagrees, not as a page that ships an unscannable square.
 */
function nayukiGrid(text: string): boolean[][] {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(`${QRCODEGEN_MIN}\nglobalThis.__qr = qrcodegen;`, sandbox);
  // The vendored encoder's surface, as this test uses it. Named rather than
  // `any`, so a refresh from upstream that renames one of these three is a
  // compile error here instead of a crash in the middle of a comparison.
  interface Qrcodegen {
    QrCode: {
      encodeText: (
        text: string,
        ecc: unknown,
      ) => { size: number; getModule: (x: number, y: number) => boolean };
      Ecc: { MEDIUM: unknown };
    };
  }
  const gen = (sandbox as { __qr: Qrcodegen }).__qr;
  const qr = gen.QrCode.encodeText(text, gen.QrCode.Ecc.MEDIUM);
  const grid: boolean[][] = [];
  for (let y = 0; y < qr.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < qr.size; x++) row.push(qr.getModule(x, y));
    grid.push(row);
  }
  return grid;
}

/** The same grid out of qrcode-svg, read off its own model. */
function referenceGrid(text: string): boolean[][] {
  const qr = new QRCode({ content: text, padding: 0, width: 100, height: 100, ecl: 'M' }) as unknown as {
    qrcode: { modules: boolean[][] };
  };
  return qr.qrcode.modules;
}

const PAYLOADS: [string, string][] = [
  ['a subscription link', 'https://nw.example.com/sub/4f8a2b1c0d3e4f5a9b6c7d8e9f0a1b2c'],
  [
    'an AmneziaVPN vpn:// key',
    `vpn://${'eNqrVkrLz1eyUvL0c1WyUsrLL1GyMjQyNjE1M7ewtLK2sbWzd3B0cnZxdXP38PTy9vH18w8IDAoOCQ0Lj4iMio6JjYtPSExKTklNS8_IzMrOyc3LLyhUqgUAKFYW0A'.repeat(3)}`,
  ],
  [
    'an AmneziaWG .conf',
    [
      '[Interface]',
      'PrivateKey = qJf3nQ0k8mWx1pL5tR7vY2cH4dB6gN9sK0aZ3eU8jF4=',
      'Address = 10.66.66.2/32',
      'DNS = 1.1.1.1',
      'Jc = 4',
      'Jmin = 40',
      'Jmax = 70',
      '',
      '[Peer]',
      'PublicKey = mB7cX2nQ9wE4rT6yU1iO3pA5sD8fG0hJ2kL4zX6cV8b=',
      'AllowedIPs = 0.0.0.0/0',
      'Endpoint = nl-1.example.com:51820',
    ].join('\n'),
  ],
];

describe('the inline QR encoder', () => {
  for (const [what, payload] of PAYLOADS) {
    it(`draws the same code as the server used to, for ${what}`, () => {
      const mine = nayukiGrid(payload);
      const theirs = referenceGrid(payload);
      expect(mine.length, 'the two encoders disagree about the size of the code').toBe(
        theirs.length,
      );
      expect(mine).toEqual(theirs);
    });
  }

  it('carries the drawer and the encoder in one script', () => {
    // If the blob is ever pasted back without the namespace, the drawer is a
    // no-op and every box stays on its fallback: correct, and silent. The
    // guard is here so a refresh that breaks it fails loudly instead.
    expect(QRCODEGEN_MIN).toContain('qrcodegen');
    expect(QR_SCRIPT).toContain('data-qr-text');
    expect(QR_SCRIPT).toContain('Ecc.MEDIUM');
  });

  it('leaves a readable answer in the box for a reader with no JavaScript', () => {
    // The rule this change must not break: the QR is a convenience, the link
    // is the substance. With JS off the reader still gets the link, and one
    // line saying why there is no picture.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const html = qrBox({
      text: 'https://nw.example.com/sub/abc',
      fallback: 'https://nw.example.com/sub/abc',
      note: 'QR is drawn in the browser',
      esc,
    });
    expect(html).toContain('data-qr-text="https://nw.example.com/sub/abc"');
    expect(html).toContain('https://nw.example.com/sub/abc</code>');
    expect(html).toContain('QR is drawn in the browser');
    // And it is marked as not-yet-drawn, so the styles can tell the two states
    // apart without the script having to add a class.
    expect(html).toContain('data-qr-pending');
  });
});
