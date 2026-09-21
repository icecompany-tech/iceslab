import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_NAMES,
  PROTOCOL_TRANSPORT,
  TRANSPORTS,
  transportOf,
  type ProtocolName,
} from '@iceslab/shared';

/**
 * The protocol-to-transport table decides whether two bindings collide on a
 * port. A protocol missing from it has no answer, and "no answer" in a
 * uniqueness check turns into either a refused legitimate deployment or an
 * accepted broken one, depending on which way the lookup happens to fall.
 *
 * Same shape of guard as contract-mirror.test.ts, and for the same reason:
 * TypeScript alone will not catch it the day a protocol is added, because
 * `Record<ProtocolName, Transport>` is satisfied by a table that was correct
 * when it was written and is now missing whatever came after.
 */
describe('every protocol says what it occupies', () => {
  it('has a row for each name in the contract, and no row for anything else', () => {
    // Guard against a vacuous pass: if the enumeration ever comes back empty
    // this test would otherwise sail through checking nothing.
    expect(PROTOCOL_NAMES.length).toBeGreaterThanOrEqual(10);

    const missing = PROTOCOL_NAMES.filter((p) => PROTOCOL_TRANSPORT[p] === undefined);
    expect(
      missing,
      `these protocols have no transport, so a port check cannot answer for them: ${missing.join(', ')}. ` +
        `Add a row to PROTOCOL_TRANSPORT and say why it is that transport.`,
    ).toEqual([]);

    const extra = Object.keys(PROTOCOL_TRANSPORT).filter(
      (p) => !(PROTOCOL_NAMES as readonly string[]).includes(p),
    );
    expect(extra, `these are not protocols any more: ${extra.join(', ')}`).toEqual([]);
  });

  it('answers with a transport that exists', () => {
    for (const p of PROTOCOL_NAMES) {
      expect(TRANSPORTS as readonly string[], p).toContain(PROTOCOL_TRANSPORT[p]);
    }
  });

  it('puts the QUIC and WireGuard protocols on udp, and the rest on tcp', () => {
    // Pinned by name rather than derived, so that a careless edit to the table
    // fails here instead of quietly letting two listeners onto one socket.
    const udp = PROTOCOL_NAMES.filter((p) => PROTOCOL_TRANSPORT[p] === 'udp').sort();
    expect(udp).toEqual(['amneziawg', 'hysteria', 'tuic']);
  });

  it('knows that xray on kcp is not on tcp', () => {
    // The one protocol whose transport is not fixed by its name. A kcp inbound
    // filed as TCP would be refused next to a REALITY that is not in its way,
    // and would collide with a UDP listener that is.
    expect(transportOf('xray')).toBe('tcp');
    expect(transportOf('xray', { network: 'raw' })).toBe('tcp');
    expect(transportOf('xray', { network: 'kcp' })).toBe('udp');
    // The config is only consulted for xray; nothing else has the knob.
    expect(transportOf('hysteria', { network: 'kcp' })).toBe('udp');
    expect(transportOf('naive', { network: 'kcp' })).toBe('tcp');
  });

  it('gives the same answer for a protocol with no config as the table does', () => {
    for (const p of PROTOCOL_NAMES as readonly ProtocolName[]) {
      expect(transportOf(p), p).toBe(PROTOCOL_TRANSPORT[p]);
    }
  });

  /**
   * The table has ONE reader, and that is the point of it.
   *
   * `PROTOCOL_TRANSPORT[protocol]` looks like the obvious thing to write at a
   * call site, and it is wrong at every call site: it misses the one exception
   * the table cannot express, xray on kcp, which is UDP. A second reader would
   * therefore not fail, it would answer TCP for a UDP listener and let two
   * things onto one socket. `transportOf` is the only place allowed to know
   * that, so the table stays inside `packages/shared` and is read here only to
   * be checked.
   */
  it('is read by transportOf alone, everywhere in the backend', () => {
    const BACKEND_SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const SELF = fileURLToPath(import.meta.url);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Prisma writes its client here; it is generated, not ours to police.
          if (entry.name === 'generated' || entry.name === 'node_modules') continue;
          walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (path === SELF) continue;
        if (readFileSync(path, 'utf8').includes('PROTOCOL_TRANSPORT')) {
          offenders.push(relative(BACKEND_SRC, path));
        }
      }
    };
    walk(BACKEND_SRC);

    expect(
      offenders,
      `these read PROTOCOL_TRANSPORT directly: ${offenders.join(', ')}. ` +
        `Call transportOf(protocol, config) instead: the table alone does not know that xray on kcp is UDP.`,
    ).toEqual([]);
  });
});
