import { describe, it, expect } from 'vitest';
import {
  generateTopologyLinks,
  topologyLinkKey,
  type LinkCred,
} from './cascade.config.js';
import { renderChainConfig } from './chain.config.js';

/**
 * E27, stand 24.09 14:14: the congestion controller chosen on the POSITION of a
 * one-leg cascade never reached the nodes. The panel answered cubic, both ends
 * ran bbr, and nothing but jq on the node could tell.
 *
 * The last leg (last position into a direction) takes its knobs from the
 * direction and, where the direction says nothing, from the position: the rule
 * the cell and the underlay already followed. Checked on what the two ends are
 * actually given, not on the stored credential alone.
 */
type TuicCred = Extract<LinkCred, { protocol: 'tuic' }>;

const ends = (cred: LinkCred) => {
  const entry = renderChainConfig({
    role: 'entry',
    socksPassword: 'p',
    directionTags: [1],
    out: [{ tag: 1, host: '192.0.2.10', cred }],
    policy: null,
  }) as { outbounds: { type: string; congestion_control?: string }[] };
  const exit = renderChainConfig({
    role: 'exit',
    socksPassword: 'p',
    in: { cred, clients: [{ tag: 1 }] },
    policy: null,
  }) as { inbounds: { type: string; congestion_control?: string }[] };
  return {
    dialled: entry.outbounds.find((o) => o.type === 'tuic')?.congestion_control,
    received: exit.inbounds.find((i) => i.type === 'tuic')?.congestion_control,
  };
};

describe('a one-leg cascade takes the congestion controller from its position', () => {
  const positions = [{ nodeIds: ['ru-01'], linkProtocol: 'tuic', linkParams: { congestion: 'cubic' as const } }];
  const directions = [{ tag: 1, nodeIds: ['se-01'] }];

  it('on a fresh leg: cubic at both ends', async () => {
    const [link] = await generateTopologyLinks(positions, directions);
    expect((link!.cred as TuicCred).congestion).toBe('cubic');
    expect(ends(link!.cred)).toEqual({ dialled: 'cubic', received: 'cubic' });
  });

  it('on a leg stored with bbr, which is the stand: the save moves it to cubic, keys kept', async () => {
    const [first] = await generateTopologyLinks(
      [{ nodeIds: ['ru-01'], linkProtocol: 'tuic' }],
      directions,
    );
    const stored = first!.cred as TuicCred;
    expect(stored.congestion).toBe('bbr');

    const [link] = await generateTopologyLinks(
      positions,
      directions,
      new Map([[topologyLinkKey('ru-01', 'se-01', 1), stored]]),
    );
    const cred = link!.cred as TuicCred;
    expect(cred.congestion).toBe('cubic');
    expect(cred.uuid).toBe(stored.uuid);
    expect(cred.password).toBe(stored.password);
    expect(ends(cred)).toEqual({ dialled: 'cubic', received: 'cubic' });
  });

  it("but a direction's own choice still wins over the position's", async () => {
    const [link] = await generateTopologyLinks(positions, [
      { tag: 1, nodeIds: ['se-01'], linkParams: { congestion: 'new_reno' as const } },
    ]);
    expect((link!.cred as TuicCred).congestion).toBe('new_reno');
  });
});
