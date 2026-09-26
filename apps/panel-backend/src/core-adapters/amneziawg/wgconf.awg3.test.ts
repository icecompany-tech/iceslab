import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AwgGeometry3 } from '@iceslab/shared';
import { buildAmneziawgClientConfig } from './wgconf.js';

/**
 * The 3.1 client .conf (t07-6c), pinned. The agent's test
 * (TestTheClientConfCarriesWhatTheNodeRuns) reads this golden and compares its
 * 3.1 block with what the node's awg3 renders from the same geometry, line
 * for line: a client that differs from its node in one key never handshakes.
 * Retake with UPDATE_GOLDEN=1.
 */
const here = dirname(fileURLToPath(import.meta.url));
const GEOMETRY3 = (
  JSON.parse(
    readFileSync(join(here, '../../../../node/internal/core/amneziawg/testdata/geometry3-minted.json'), 'utf8'),
  ) as AwgGeometry3[]
)[0]!;

const opts = {
  privateKey: 'cliPriv64',
  allowedIp: '10.67.67.2/32',
  serverPublicKey: 'srvPub64',
  host: 'de.example.com',
  port: 51830,
  jc: 4,
  jmin: 40,
  jmax: 70,
  s1: 0,
  s2: 0,
  s3: 0,
  s4: 0,
  h1: 1111111111,
  h2: 2222222222,
  h3: 3333333333,
  h4: 4444444444,
  geometry3: GEOMETRY3,
};

describe('the 3.1 client .conf', () => {
  const conf = buildAmneziawgClientConfig(opts);

  it('golden wgconf-awg3.conf', () => {
    const path = join(here, '__testdata__', 'wgconf-awg3.conf');
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(path, conf);
      return;
    }
    expect(conf, 'golden wgconf-awg3.conf is out of date; retake with UPDATE_GOLDEN=1').toBe(
      readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
    );
  });

  it('carries the geometry and not the profile numbers', () => {
    expect(conf).toContain(`MTU = ${GEOMETRY3.mtu}\n`);
    expect(conf).toContain(`HeaderProtectionKey = ${GEOMETRY3.headerProtectionKey}\n`);
    expect(conf).toContain('RandomTrailers = on\n');
    expect(conf).toContain(`H1 = ${GEOMETRY3.h1}\n`);
    expect(conf).not.toContain('1111111111');
  });

  it('leaves the 1.x .conf exactly as it was', () => {
    const { geometry3: _unused, ...one } = opts;
    const plain = buildAmneziawgClientConfig(one);
    expect(plain).not.toMatch(/HeaderProtectionKey|MTU/);
    expect(plain).toContain('H1 = 1111111111\n');
  });
});
