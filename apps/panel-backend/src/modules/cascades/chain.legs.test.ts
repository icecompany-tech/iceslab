import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINK_CELL_TRANSPORT } from '@iceslab/shared';
import { renderChainConfig, type ChainRenderInput } from './chain.config.js';
import { LINK_PORT_BASE, type LinkCred } from './cascade.config.js';
import type { LinkTls } from './link-tls.js';
import { chainPoliciesOf } from './chain-policy.js';

/**
 * The chain of cut 5: four hops and three different cells.
 *
 *   xray entry --hy2--> sing-box --tuic--> sing-box --ss--> xray exit
 *
 * Deliberately one cell per leg rather than the same one three times. A chain
 * where every leg is the same cell tests the cell once and the CHAINING three
 * times; this one tests that a node can receive on one cell and dial out on
 * another, which is the thing phase 5 is actually adding and the thing a
 * transit does.
 *
 * ⚠ THE SECRETS HERE ARE FIXTURES and the certificate says so in its own
 * subject: `CN=iceslab-fixture-not-a-secret`. They live beside the goldens
 * because a golden with a freshly minted key would differ on every run and
 * prove nothing. `.gitleaks.toml` allows this key by VALUE, and the last test
 * in this file is what keeps it from spreading outside `__testdata__`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '__testdata__');

const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const FIXTURE_TLS: LinkTls = {
  certPem: readFileSync(join(GOLDEN_DIR, 'link-fixture-cert.pem'), 'utf8'),
  keyPem: readFileSync(join(GOLDEN_DIR, 'link-fixture-key.pem'), 'utf8'),
};

const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The three legs, one cell each, ports by the step they terminate on. */
const HY2_LEG: LinkCred = {
  protocol: 'hy2',
  port: LINK_PORT_BASE,
  authPassword: 'hy2-fixture-auth-not-a-secret',
  obfsPassword: 'hy2-fixture-salt-not-a-secret',
  tls: FIXTURE_TLS,
};

const TUIC_LEG: LinkCred = {
  protocol: 'tuic',
  port: LINK_PORT_BASE + 1,
  uuid: uuidFor(2),
  password: 'tuic-fixture-pass-not-a-secret',
  congestion: 'bbr',
  tls: FIXTURE_TLS,
};

const SS_LEG: LinkCred = {
  protocol: 'shadowsocks',
  port: LINK_PORT_BASE + 2,
  psk: 'aWNlc2xhYi1jaGFpbi1maXh0dXJlLXBzay0wMDAwMDA=',
  method: '2022-blake3-aes-256-gcm',
};

/** One route policy, drawn on the entry only (phase 9.3), under user p1. */
const { policies: POLICIES } = chainPoliciesOf([
  { ordinal: 1, directDomains: ['gosuslugi.ru'], blockDomains: ['ads.example'] },
]);

/** The entry hands its user core one way out and dials the hy2 leg. */
const entry: ChainRenderInput = {
  role: 'entry',
  socksPassword: 'chain-socks-fixture-password-0000',
  directionTags: [1],
  out: [{ tag: 1, host: 'hop-1.example.com', cred: HY2_LEG }],
  policies: POLICIES,
};

/** First transit: receives hy2, forwards over tuic. */
const transit1: ChainRenderInput = {
  role: 'transit',
  socksPassword: 'chain-socks-fixture-password-0000',
  in: { cred: HY2_LEG, clients: [{ tag: 1 }] },
  out: [{ tag: 1, host: 'hop-2.example.com', cred: TUIC_LEG }],
};

/** Second transit: receives tuic, forwards over shadowsocks. */
const transit2: ChainRenderInput = {
  role: 'transit',
  socksPassword: 'chain-socks-fixture-password-0000',
  in: { cred: TUIC_LEG, clients: [{ tag: 1 }] },
  out: [{ tag: 1, host: 'exit.example.com', cred: SS_LEG }],
};

const exit: ChainRenderInput = {
  role: 'exit',
  socksPassword: 'chain-socks-fixture-password-0000',
  in: { cred: SS_LEG, clients: [{ tag: 1 }] },
};

const HOPS: readonly (readonly [string, ChainRenderInput])[] = [
  ['entry', entry],
  ['transit-1', transit1],
  ['transit-2', transit2],
  ['exit', exit],
];

function engineAccepts(config: unknown): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'iceslab-legs-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  try {
    return { ok: true, output: execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` };
  }
}

function golden(name: string, value: unknown): void {
  const path = join(GOLDEN_DIR, `${name}.json`);
  const got = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(path, got);
    return;
  }
  expect(got, `golden ${name} is out of date; retake with UPDATE_GOLDEN=1 and read the diff`).toBe(
    readFileSync(path, 'utf8'),
  );
}

describe('a chain of four hops and three cells', () => {
  for (const [name, input] of HOPS) {
    it(`matches the golden for ${name}`, () => {
      golden(`chain5-${name}`, renderChainConfig(input));
    });

    it.skipIf(!SINGBOX_BIN)(`is a config sing-box will load, ${name}`, () => {
      const verdict = engineAccepts(renderChainConfig(input));
      expect(verdict.ok, verdict.output).toBe(true);
    });
  }

  it('records what each leg is, without its secrets', () => {
    // The second golden the plan asks for: the SHAPE of the three legs, so a
    // change of cell, port or transport shows up as a one-line diff instead of
    // being buried in a config. No secret goes in it, which is also why it can
    // be read at a glance.
    golden(
      'chain5-legs',
      [HY2_LEG, TUIC_LEG, SS_LEG].map((cred) => ({
        cell: cred.protocol,
        port: cred.port,
        transport: LINK_CELL_TRANSPORT[cred.protocol],
      })),
    );
  });

  it('gives each QUIC leg a pinned certificate and never insecure', () => {
    // The two halves that make a leg unfakeable. Asserted on the rendered
    // config rather than on the renderer, because this is the thing that
    // reaches the node.
    for (const [name, input] of HOPS) {
      const cfg = renderChainConfig(input) as {
        inbounds: Record<string, unknown>[];
        outbounds: Record<string, unknown>[];
      };
      for (const o of cfg.outbounds) {
        if (o.type !== 'hysteria2' && o.type !== 'tuic') continue;
        const tls = o.tls as { insecure?: boolean; certificate?: string[] };
        expect(tls.insecure, `${name}: a leg that accepts any certificate`).toBe(false);
        expect(tls.certificate?.[0], `${name}: a leg with no pin`).toContain('BEGIN CERTIFICATE');
      }
      for (const i of cfg.inbounds) {
        if (i.type !== 'hysteria2' && i.type !== 'tuic') continue;
        const tls = i.tls as { certificate?: string[]; key?: string[] };
        // Inline, both halves. A `certificate_path` here would mean the key
        // lives on the node, minted by something else and rotated by nobody.
        expect(tls.certificate?.[0]).toContain('BEGIN CERTIFICATE');
        expect(tls.key?.[0]).toContain('PRIVATE KEY');
        expect(Object.keys(tls)).not.toContain('certificate_path');
      }
    }
  });

  it('obfuscates the hy2 leg on both ends with the same salt', () => {
    // Salamander or the leg looks like QUIC with a hat on. Both ends or the
    // packets are not valid to each other, which is the failure that looks
    // like "the node is up and nothing goes through".
    const dialled = (renderChainConfig(entry) as { outbounds: Record<string, unknown>[] }).outbounds.find(
      (o) => o.type === 'hysteria2',
    )!;
    const received = (renderChainConfig(transit1) as { inbounds: Record<string, unknown>[] }).inbounds.find(
      (i) => i.type === 'hysteria2',
    )!;
    expect(dialled.obfs).toEqual({ type: 'salamander', password: HY2_LEG.obfsPassword as string });
    expect(received.obfs).toEqual(dialled.obfs);
  });

  it('keeps the fixture key out of everything but its own directory', () => {
    /**
     * ⚠ The rule that lets this key exist in the repository at all.
     *
     * It is a fixture, its subject says so, and `.gitleaks.toml` allows it by
     * value. What must never happen is the same bytes turning up somewhere the
     * allowlist does not cover, because then either the scan goes red on a real
     * file or, worse, somebody widens the allowlist to a directory.
     *
     * Checked over the module's own source, which is where a copy would land:
     * a test that pasted the PEM inline instead of reading the file.
     */
    const body = FIXTURE_TLS.keyPem.split('\n').filter((l) => l.length > 40)[1]!;
    const sources = [
      'chain.legs.test.ts',
      'chain.config.ts',
      'chain.config.test.ts',
      'link-tls.ts',
      'cascade.config.ts',
    ];
    for (const file of sources) {
      expect(readFileSync(join(HERE, file), 'utf8'), `${file} carries the fixture key inline`).not.toContain(
        body,
      );
    }
  });
});
