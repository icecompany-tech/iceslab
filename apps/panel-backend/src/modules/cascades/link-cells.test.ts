import { describe, it, expect } from 'vitest';
import {
  LINK_CELLS,
  LINK_CELL_ENGINES,
  LINK_CELL_TRANSPORT,
  PROTOCOL_NAMES,
  TRANSPORTS,
  ENGINE_NAMES,
} from '@iceslab/shared';

/**
 * The two dictionaries that meet in one stored column.
 *
 * A CELL is what one hop says to the next; a PROTOCOL is what a node serves
 * users with. They share two words and nothing else, and the column
 * `linkProtocol` has carried both spellings since the cascade was written: that
 * is how a hop saved as "hysteria" once became a vless leg without a word.
 *
 * These tests are cheap and none of them is decorative. Each one is a way the
 * two tables could quietly stop describing the same four cells.
 */
describe('the link cells', () => {
  it('names every cell in both tables', () => {
    // A cell added to one table and not the other is the failure this guards:
    // the engines table would refuse it as unknown while the transport table
    // said it was TCP, or the other way round.
    expect(Object.keys(LINK_CELL_ENGINES).sort()).toEqual([...LINK_CELLS].sort());
    expect(Object.keys(LINK_CELL_TRANSPORT).sort()).toEqual([...LINK_CELLS].sort());
  });

  it('names engines that exist and transports that exist', () => {
    for (const cell of LINK_CELLS) {
      expect(LINK_CELL_ENGINES[cell].length, `${cell} is carried by nothing`).toBeGreaterThan(0);
      for (const engine of LINK_CELL_ENGINES[cell]) {
        expect(ENGINE_NAMES as readonly string[], `${cell} names a non-engine`).toContain(engine);
      }
      expect(TRANSPORTS as readonly string[]).toContain(LINK_CELL_TRANSPORT[cell]);
    }
  });

  it('keeps the chain process able to receive every cell', () => {
    // Since phase 4 the receiving side of a leg IS the chain process. A cell
    // it cannot terminate is a cell nothing can terminate, and the table would
    // be promising a leg that never comes up.
    for (const cell of LINK_CELLS) {
      expect(LINK_CELL_ENGINES[cell], `${cell} cannot be received by the chain`).toContain(
        'singbox',
      );
    }
  });

  it('remembers that an old agent still terminates the two original cells', () => {
    // The transitional fleet. An agent that predates the chain ends a vless or
    // shadowsocks leg inside its own xray, and a panel that forgot would refuse
    // a cascade which is working right now.
    expect(LINK_CELL_ENGINES.vless).toContain('xray');
    expect(LINK_CELL_ENGINES.shadowsocks).toContain('xray');
    // And it never terminated these two, which is the whole reason phase 5
    // needs the chain first.
    expect(LINK_CELL_ENGINES.hy2).not.toContain('xray');
    expect(LINK_CELL_ENGINES.tuic).not.toContain('xray');
  });

  it('overlaps the protocol names on exactly the two words it should', () => {
    // ⚠ `hy2` is the cell and `hysteria` is the protocol: the same wire format
    // under two jobs. The test is here because the temptation to "unify" them
    // is permanent, and unifying them would make the stored column ambiguous
    // again rather than less so.
    const shared = LINK_CELLS.filter((c) => (PROTOCOL_NAMES as readonly string[]).includes(c));
    expect(shared).toEqual(['vless', 'shadowsocks'].filter((c) =>
      (PROTOCOL_NAMES as readonly string[]).includes(c),
    ));
    expect(LINK_CELLS as readonly string[]).not.toContain('hysteria');
    expect(PROTOCOL_NAMES as readonly string[]).not.toContain('hy2');
  });

  it('gives the two new cells UDP and the two old ones TCP', () => {
    // Not a restatement of the table: it is what the port check will compare
    // against a binding, and getting it backwards means a leg and a user
    // inbound share a port number and one of them fails to bind on the node.
    expect(LINK_CELL_TRANSPORT.hy2).toBe('udp');
    expect(LINK_CELL_TRANSPORT.tuic).toBe('udp');
    expect(LINK_CELL_TRANSPORT.vless).toBe('tcp');
    expect(LINK_CELL_TRANSPORT.shadowsocks).toBe('tcp');
  });
});
