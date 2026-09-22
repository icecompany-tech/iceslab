import { describe, it, expect } from 'vitest';
import { LINK_CELLS } from '@iceslab/shared';
import {
  DEFAULT_LINK_CONGESTION,
  generateTopologyLinks,
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
  it('mints one for every cell there is', async () => {
    // Fails the day a cell is added to LINK_CELLS with no credentials behind
    // it, instead of that cell quietly generating as vless.
    for (const cell of LINK_CELLS) {
      const cred = await newLinkCred(cell, 24000);
      expect(cred.protocol, `${cell} minted something else`).toBe(cell);
      expect(cred.port).toBe(24000);
    }
  });

  it('survives the round trip through storage, field for field', async () => {
    for (const cell of LINK_CELLS) {
      const minted = await newLinkCred(cell, 24001);
      const back = parseLinkCred(serializeLinkCred(minted));
      expect(back, `${cell} did not parse back`).not.toBeNull();
      // ⚠ vless used to be the one that did NOT round trip whole: the REALITY
      // block was dropped on the way to the column and minted again on the next
      // save, which is why the hardening of 2026-08 never reached a node. Since
      // 5b it survives like everything else, and this line is what says so.
      expect(back).toEqual(minted);
    }
  });

  it('gives a tuic leg the default controller, and takes the operator choice', async () => {
    expect((await newLinkCred('tuic', 24000) as { congestion: string }).congestion).toBe(
      DEFAULT_LINK_CONGESTION,
    );
    expect((await newLinkCred('tuic', 24000, 'new_reno') as { congestion: string }).congestion).toBe(
      'new_reno',
    );
  });

  it('gives an hy2 leg no controller at all, because the engine refuses one', async () => {
    // ⚠ MEASURED. sing-box 1.13.14 rejects `congestion_control` on a hysteria2
    // endpoint at decode, so a field here would be a control that refuses the
    // config on the node while the panel reports the leg saved. Hysteria2's
    // rate control is Brutal, expressed as a bandwidth pair, which is a
    // different question and not this one.
    expect(await newLinkCred('hy2', 24000)).not.toHaveProperty('congestion');
  });

  it('reads an unreadable controller as the default rather than refusing the leg', async () => {
    // The knob is a preference, not a credential: a row hand-edited into
    // nonsense should still bring the leg up.
    //
    // `brutal` is the trap and the reason this case uses it: it is a real word
    // in the hysteria2 world, it was in this panel's own type for a day, and
    // sing-box answers "unknown congestion control algorithm: brutal" for a
    // tuic endpoint. Stored, it must read as the default, not travel through.
    const broken = {
      protocol: 'tuic',
      port: 24000,
      uuid: 'u',
      password: 'p',
      congestion: 'brutal',
      // The TLS pair has to be there and whole, which is a different rule from
      // the knob: a leg without it cannot be configured at all.
      tls: { certPem: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----', keyPem: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----' },
    };
    expect((parseLinkCred(broken) as { congestion: string }).congestion).toBe(
      DEFAULT_LINK_CONGESTION,
    );
  });

  it('refuses half a credential instead of rendering a leg that cannot answer', async () => {
    // Half a credential renders a config one side cannot complete: the leg
    // comes up and refuses every packet, which is harder to read than a leg
    // that was never rendered at all.
    expect(parseLinkCred({ protocol: 'hy2', port: 24000, authPassword: 'a' })).toBeNull();
    expect(parseLinkCred({ protocol: 'tuic', port: 24000, uuid: 'u' })).toBeNull();
  });

  it('mints a different secret every time', async () => {
    // Two legs of one cascade must not share a password: one compromised node
    // would otherwise open every other leg of the same cell.
    const secrets = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const hy2 = await newLinkCred('hy2', 24000) as { authPassword: string; obfsPassword: string };
      secrets.add(hy2.authPassword);
      secrets.add(hy2.obfsPassword);
    }
    expect(secrets.size).toBe(10);
  });

  it('reaches a direction over ITS cell, and over the entry cell when it names none', async () => {
    /**
     * The one leg a direction may choose, phase 5.
     *
     * Null is not "unset waiting for a value", it is the answer every cascade
     * gave before the field existed: the entry's cell. That is why the goldens
     * of the four-hop fixture do not move with this change, and why no stored
     * cascade needed a backfill.
     */
    const positions = [{ nodeIds: ['n-entry'], linkProtocol: 'vless' }];
    const links = await generateTopologyLinks(positions, [
      // Names its own cell: reached over tuic, with the operator's controller.
      { tag: 1, nodeIds: ['n-nl'], linkProtocol: 'tuic', linkParams: { congestion: 'cubic' } },
      // Names none: reached over the entry's cell, as always.
      { tag: 2, nodeIds: ['n-se'] },
    ]);
    const byTag = new Map(links.map((l) => [l.directionTag, l]));
    expect(byTag.get(1)!.cred.protocol).toBe('tuic');
    expect((byTag.get(1)!.cred as { congestion: string }).congestion).toBe('cubic');
    expect(byTag.get(2)!.cred.protocol).toBe('vless');
    // Both land on the same port: a direction is not a step of its own, so the
    // leg into it terminates on the step after the last position.
    expect(byTag.get(1)!.cred.port).toBe(byTag.get(2)!.cred.port);
  });

  it('keeps the two QUIC cells out of the legacy xray drawing', async () => {
    // They exist only inside the chain process. The old fragment builder used
    // to turn anything it did not recognise into vless, which is how an
    // operator's choice became something else without a word.
    const hy2: LinkCred = await newLinkCred('hy2', 24000);
    expect(hy2.protocol).toBe('hy2');
  });
});
