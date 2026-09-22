import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LINK_CELLS,
  LINK_CELL_ENGINES,
  LINK_CELL_TRANSPORT,
  LINK_CONGESTIONS,
  DEFAULT_LINK_CONGESTION,
  PROTOCOL_NAMES,
  TRANSPORTS,
  ENGINE_NAMES,
} from '@iceslab/shared';
import { DEFAULT_LINK_CONGESTION as REEXPORTED_DEFAULT, linkCellFor } from './cascade.config.js';
import { CascadeDirectionSchema } from './cascade.schemas.js';
import { getLogger } from '../../lib/infra/logger.js';

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

  it('overlaps the protocol names on exactly two words, and they are not the expected two', () => {
    /**
     * ⚠ MEASURED, not assumed, and the measurement corrected the assumption.
     *
     * The overlap between cells and protocols is `shadowsocks` and `tuic`, NOT
     * `vless` and `shadowsocks`:
     *
     *   - `vless` is a cell and is NOT a ProtocolName at all. What a node
     *     serves users with is `xray`, the engine; vless is a subprotocol
     *     inside it. So the two dictionaries do not even agree on the word
     *     everybody calls the default cell;
     *   - `tuic` is BOTH: a protocol a node serves users with (sing-box, since
     *     the tuic slice) and, from phase 5, a cell between hops. Same word,
     *     two jobs, and a `linkProtocol` column holding "tuic" is ambiguous on
     *     its face.
     *
     * This is why the column and the tables must never be merged "because the
     * names look the same". They look the same in two places out of four, and
     * neither is the place one would guess.
     */
    const overlap = LINK_CELLS.filter((c) => (PROTOCOL_NAMES as readonly string[]).includes(c));
    expect(overlap.sort()).toEqual(['shadowsocks', 'tuic']);
    // The pair that reads as one thing and is two: cell `hy2`, protocol
    // `hysteria`.
    expect(LINK_CELLS as readonly string[]).not.toContain('hysteria');
    expect(PROTOCOL_NAMES as readonly string[]).not.toContain('hy2');
    // And the cell nobody can name as a protocol.
    expect(PROTOCOL_NAMES as readonly string[]).not.toContain('vless');
  });

  it('reads a stored value as a cell, and refuses a protocol that never was one', () => {
    // The column holds cells since the migration. A protocol name that is not
    // also a cell described a leg that never existed, so it answers null and
    // the save refuses it.
    expect(linkCellFor('vless')).toBe('vless');
    expect(linkCellFor('shadowsocks')).toBe('shadowsocks');
    expect(linkCellFor(null)).toBe('vless'); // "the entry's own cell"
    for (const protocolOnly of ['hysteria', 'mieru', 'naive', 'amneziawg', 'anytls']) {
      expect(linkCellFor(protocolOnly), `${protocolOnly} is not a cell`).toBeNull();
    }
    /**
     * ⚠ `tuic` reads as a CELL now, and only because the migration made that
     * safe.
     *
     * It is a legal protocol AND, since phase 5, a legal cell. Every row that
     * held the word before the cells landed was rewritten to NULL by
     * `20260922061809_link_protocol_is_a_cell`, so a stored `tuic` can no
     * longer be the protocol somebody once picked for a leg that never worked.
     * Doing the dictionary before the cells is what buys this line.
     */
    expect(linkCellFor('tuic')).toBe('tuic');
    expect(linkCellFor('hy2')).toBe('hy2');
  });

  it('still takes the old engine name for one release, and says so', () => {
    const warnings: string[] = [];
    vi.spyOn(getLogger(), 'warn').mockImplementation((msg: unknown) => {
      warnings.push(String(msg));
    });
    expect(linkCellFor('xray')).toBe('vless');
    // Translated AND logged: a shim nobody can see is a shim nobody removes.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('xray');
    expect(warnings[0]).toContain('one release');
    vi.restoreAllMocks();
  });

  it('has a branch in the chain renderer for every cell, and no branch for anything else', () => {
    /**
     * The composition guard, read off the SOURCE.
     *
     * A cell in the table with no branch renders as a thrown error at push
     * time, on a node, hours after somebody saved the cascade. A branch with no
     * cell is dead code that looks like support. Neither is visible to the type
     * checker: `LinkCred.protocol` and `LinkCell` agree today by construction,
     * and the day they stop agreeing is the day this matters.
     *
     * Reads the file rather than exercising the renderer because exercising it
     * needs a credential per cell, which is the thing that would be missing.
     */
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'chain.config.ts'),
      'utf8',
    );
    const branches = new Set([...src.matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]!));
    // Fails rather than passes empty: a pattern that matches nothing would make
    // every assertion below vacuous.
    expect(branches.size, 'no case labels found in chain.config.ts').toBeGreaterThan(1);
    for (const cell of LINK_CELLS) {
      expect(branches, `the chain renderer has no branch for ${cell}`).toContain(cell);
    }
    // And the other way: every label is a cell. The renderer switches on
    // nothing else, so a stray label means somebody branched on a different
    // vocabulary again.
    for (const label of branches) {
      expect(LINK_CELLS as readonly string[], `${label} is a branch for a non-cell`).toContain(
        label,
      );
    }
  });

  it('offers the three controllers the engine takes, and never brutal', () => {
    /**
     * The composition guard for the congestion dictionary, which used to exist
     * in three copies: here, on `TuicInboundCfg.congestionControl` as a literal
     * union, and again in the frontend. One list now, in shared.
     *
     * `brutal` is the value the guard is really about. It is a real word in the
     * hysteria2 world, it was in this panel's own type for a day, and sing-box
     * 1.13.14 answers "unknown congestion control algorithm: brutal" for a tuic
     * endpoint: offering it would be a control that refuses the config on the
     * node while the panel reports the leg saved.
     *
     * Asserted through the API SCHEMA and not only against the array, because
     * the array is what the schema is built from and comparing it with itself
     * would pass whatever it said.
     */
    expect([...LINK_CONGESTIONS]).toEqual(['bbr', 'cubic', 'new_reno']);
    // The default is a member of the list it defaults within, which is the one
    // way a shared default can still be wrong: the screen would print a word
    // the schema refuses the moment it is sent back.
    expect(LINK_CONGESTIONS as readonly string[]).toContain(DEFAULT_LINK_CONGESTION);
    // And the cascade module re-exports THAT one rather than keeping its own.
    expect(REEXPORTED_DEFAULT).toBe(DEFAULT_LINK_CONGESTION);
    for (const cc of LINK_CONGESTIONS) {
      expect(
        CascadeDirectionSchema.safeParse({ nodeIds: [], linkParams: { congestion: cc } }).success,
        `${cc} is refused by the schema`,
      ).toBe(true);
    }
    expect(
      CascadeDirectionSchema.safeParse({ nodeIds: [], linkParams: { congestion: 'brutal' } })
        .success,
    ).toBe(false);
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
