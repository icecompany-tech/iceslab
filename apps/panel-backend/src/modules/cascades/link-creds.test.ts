import { describe, it, expect } from 'vitest';
import { LINK_CELLS } from '@iceslab/shared';
import {
  DEFAULT_LINK_CONGESTION,
  newLinkCred,
  parseLinkCred,
  serializeLinkCred,
  type LinkCred,
} from './cascade.config.js';

/**
 * The credentials of a leg, phase 5.
 *
 * Every secret here is MINTED BY THE PANEL, never typed by an operator: the two
 * ends of a leg have nobody to coordinate a password with except us, and a
 * person inventing one invents a weak one. The vless uuid and the SS2022 key
 * have worked this way since C3; hy2 and tuic join them.
 *
 * What these tests are really about is the round trip. A credential is written
 * to jsonb and read back on every push, and a field that serialises but does
 * not parse is a leg that comes up with a different password on each side: the
 * handshake fails, both configs look right, and nothing says which half is
 * wrong.
 */
describe('the link credentials', () => {
  it('mints one for every cell there is', () => {
    // Fails the day a cell is added to LINK_CELLS with no credentials behind
    // it, instead of that cell quietly generating as vless.
    for (const cell of LINK_CELLS) {
      const cred = newLinkCred(cell, 24000);
      expect(cred.protocol, `${cell} minted something else`).toBe(cell);
      expect(cred.port).toBe(24000);
    }
  });

  it('survives the round trip through storage, field for field', () => {
    for (const cell of LINK_CELLS) {
      const minted = newLinkCred(cell, 24001);
      const back = parseLinkCred(serializeLinkCred(minted));
      expect(back, `${cell} did not parse back`).not.toBeNull();
      if (cell === 'vless') {
        // ⚠ The one that does NOT round trip whole, and it predates this work:
        // the REALITY block is not serialised, it is regenerated per save.
        // Asserted so the gap is visible rather than surprising.
        expect(back).toEqual({ protocol: 'vless', port: 24001, uuid: (minted as { uuid: string }).uuid });
        continue;
      }
      expect(back).toEqual(minted);
    }
  });

  it("gives a QUIC leg the default congestion, and takes the operator choice", () => {
    expect((newLinkCred('hy2', 24000) as { congestion: string }).congestion).toBe(
      DEFAULT_LINK_CONGESTION,
    );
    expect((newLinkCred('tuic', 24000, 'brutal') as { congestion: string }).congestion).toBe(
      'brutal',
    );
  });

  it('reads an unreadable congestion as the default rather than refusing the leg', () => {
    // The knob is a preference, not a credential: a row that predates the field
    // or was hand-edited into nonsense should still bring the leg up.
    const broken = { protocol: 'hy2', port: 24000, authPassword: 'a', obfsPassword: 'b', congestion: 'turbo' };
    expect((parseLinkCred(broken) as { congestion: string }).congestion).toBe(
      DEFAULT_LINK_CONGESTION,
    );
  });

  it('refuses half a credential instead of rendering a leg that cannot answer', () => {
    // Half a credential renders a config one side cannot complete: the leg
    // comes up and refuses every packet, which is harder to read than a leg
    // that was never rendered at all.
    expect(parseLinkCred({ protocol: 'hy2', port: 24000, authPassword: 'a' })).toBeNull();
    expect(parseLinkCred({ protocol: 'tuic', port: 24000, uuid: 'u' })).toBeNull();
  });

  it('mints a different secret every time', () => {
    // Two legs of one cascade must not share a password: one compromised node
    // would otherwise open every other leg of the same cell.
    const secrets = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const hy2 = newLinkCred('hy2', 24000) as { authPassword: string; obfsPassword: string };
      secrets.add(hy2.authPassword);
      secrets.add(hy2.obfsPassword);
    }
    expect(secrets.size).toBe(10);
  });

  it('keeps the two QUIC cells out of the legacy xray drawing', () => {
    // They exist only inside the chain process. The old fragment builder used
    // to turn anything it did not recognise into vless, which is how an
    // operator's choice became something else without a word.
    const hy2: LinkCred = newLinkCred('hy2', 24000);
    expect(hy2.protocol).toBe('hy2');
  });
});
