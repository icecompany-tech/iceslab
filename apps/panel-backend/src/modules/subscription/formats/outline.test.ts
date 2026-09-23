import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOutlineJson, outlineAccessKey } from './outline.js';
import { endpointsForFormat, type SubscriptionEndpoint } from '../subscription.formats.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testdata__');

/**
 * The body the Outline app reads behind an ssconf:// key, whole.
 *
 *   outline-object  one Shadowsocks server as the legacy object, the four keys
 *                   the app reads and nothing else: an unknown key fails the
 *                   whole key (outline-apps configregistry/config_shadowsocks_test.go:141);
 *   outline-empty   no Shadowsocks endpoint: an empty body, as wgconf answers.
 */
function golden(name: string, got: string): void {
  const path = join(GOLDEN_DIR, `${name}.json`);
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(path, got);
    return;
  }
  // CRLF folded: `*.json` is `text` in .gitattributes, so a Windows checkout
  // hands this file back with CRLF, which is not a change to the body.
  expect(got, `golden ${name} is out of date; retake with UPDATE_GOLDEN=1 and read the diff`).toBe(
    readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
  );
}

const ss = (nodeName: string, host: string, port: number): SubscriptionEndpoint => ({
  protocol: 'shadowsocks',
  nodeName,
  host,
  port,
  method: 'chacha20-ietf-poly1305',
  password: `pw-${nodeName}`,
  uri: `ss://x@${host}:${port}`,
});

const hy: SubscriptionEndpoint = {
  protocol: 'hysteria',
  nodeName: 'de-1',
  host: 'de.example.com',
  port: 443,
  password: 'hy',
  uri: 'hysteria2://hy@de.example.com:443',
};

const DE = ss('de-1', 'de.example.com', 8388);
const NL = ss('nl-1', 'nl.example.com', 8389);

describe('buildOutlineJson: an Outline dynamic key', () => {
  it('outline-object: one server, the legacy object', () => {
    golden('outline-object', buildOutlineJson([hy, DE, NL]));
  });

  it('outline-empty: no Shadowsocks endpoint, empty body', () => {
    golden('outline-empty', buildOutlineJson([hy]));
    expect(buildOutlineJson([])).toBe('');
  });

  it('carries exactly the four keys the app reads', () => {
    expect(Object.keys(JSON.parse(buildOutlineJson([DE])))).toEqual([
      'server',
      'server_port',
      'method',
      'password',
    ]);
  });

  it('&node= picks the server, and without it the first', () => {
    expect(JSON.parse(buildOutlineJson([DE, NL], 'nl-1'))).toMatchObject({
      server: 'nl.example.com',
      server_port: 8389,
      password: 'pw-nl-1',
    });
    expect(JSON.parse(buildOutlineJson([DE, NL]))).toMatchObject({ server: 'de.example.com' });
  });

  it('&node= naming no Shadowsocks node answers empty, not another server', () => {
    // Handing out a different server than the link names would be a silent
    // substitution: the person pasted a key labelled with that node.
    expect(buildOutlineJson([DE, NL], 'fr-1')).toBe('');
    expect(buildOutlineJson([hy, DE], 'de-1')).toContain('de.example.com');
  });

  it('never reaches a 2022-blake3 server: the gate drops it before the builder', () => {
    const ss2022 = { ...NL, method: '2022-blake3-aes-128-gcm' } as SubscriptionEndpoint;
    const served = endpointsForFormat('outline', [ss2022, DE]);
    expect(served).toEqual([DE]);
    expect(buildOutlineJson(served, 'nl-1')).toBe('');
  });
});

describe('outlineAccessKey', () => {
  it('turns the https subscription address into ssconf://, node in query and name', () => {
    expect(outlineAccessKey('https://panel.example.com/sub/abc123', 'de-1')).toBe(
      'ssconf://panel.example.com/sub/abc123?format=outline&node=de-1#de-1',
    );
  });

  it('encodes a node name that is not URL-safe', () => {
    expect(outlineAccessKey('https://p.example/sub/t', 'Франкфурт 1')).toBe(
      'ssconf://p.example/sub/t?format=outline&node=%D0%A4%D1%80%D0%B0%D0%BD%D0%BA%D1%84%D1%83%D1%80%D1%82%201#%D0%A4%D1%80%D0%B0%D0%BD%D0%BA%D1%84%D1%83%D1%80%D1%82%201',
    );
  });

  it('has no key for a panel on plain http: the app fetches ssconf over https only', () => {
    expect(outlineAccessKey('http://panel.example.com/sub/abc123', 'de-1')).toBeUndefined();
  });
});
