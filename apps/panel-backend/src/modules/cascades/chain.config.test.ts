import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAIN_PROTECTION_RULES,
  chainSocksPort,
  renderChainConfig,
  type ChainRenderInput,
} from './chain.config.js';
import { LINK_PORT_BASE } from './cascade.config.js';

/**
 * The chain config, three roles, asked of the engine that has to load it.
 *
 * Structure tests cannot answer the only question that matters on a node: will
 * sing-box start. `sing-box check` can, and CI installs the pinned binary for
 * exactly that. Without SINGBOX_BIN the engine cases skip themselves, the same
 * arrangement the xray cascade tests have, so a laptop without one still runs
 * the suite.
 *
 * The fixture is the shape of the stand, not the smallest thing that works:
 * TWO ways out, and a pool of two nodes on the entry step. With one direction
 * the per-direction routing has nothing to tell apart, so a gate on tags
 * passes while doing nothing, which is how the A4 tags went out broken under
 * green tests.
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testdata__');

const REALITY = {
  privateKey: 'k'.repeat(43),
  publicKey: 'p'.repeat(43),
  shortId: '0123abcd',
  serverName: 'www.microsoft.com',
  dest: 'www.microsoft.com:443',
};

/**
 * The socks password the fixtures carry, written to be recognised.
 *
 * A fixture credential is key-shaped by necessity, and the secret scanner
 * judges a string by how much it looks like one: the previous value read as a
 * password and turned CI red from inside a golden, one directory away from the
 * test the allowlist covers. So the value says what it is, and `.gitleaks.toml`
 * allows THIS VALUE rather than the directory, which keeps the golden a place
 * where a real key pasted in would still be caught.
 */
const FIXTURE_SOCKS_PASSWORD = 'chain-socks-fixture-password-0000';

/**
 * The SS2022 key on the transit's second leg, same reasoning.
 *
 * This one cannot merely say what it is: 2022-blake3-aes-256-gcm takes exactly
 * 32 bytes of base64, and a key of the wrong length does not exercise the code
 * path the fixture exists for. So it is base64 of the readable literal
 * "iceslab-chain-fixture-psk-000000", which is 32 bytes and decodes to a
 * sentence, the same trick the cascade goldens' fake REALITY key uses.
 */
const FIXTURE_SS_PSK = 'aWNlc2xhYi1jaGFpbi1maXh0dXJlLXBzay0wMDAwMDA=';

const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const POLICY = { directDomains: ['gosuslugi.ru'], blockDomains: ['ads.example'] };

/** The entry: two ways out and the Auto line beside them. */
export const entryInput: ChainRenderInput = {
  role: 'entry',
  socksPassword: FIXTURE_SOCKS_PASSWORD,
  directionTags: [0, 1, 2],
  out: [
    {
      tag: 0,
      host: 'nl-1.example.com',
      cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(1), reality: REALITY },
    },
    {
      tag: 1,
      host: 'nl-1.example.com',
      cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(2), reality: REALITY },
    },
    {
      tag: 2,
      host: 'se-1.example.com',
      cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(3), reality: REALITY },
    },
  ],
  policy: POLICY,
};

/** A transit carrying both ways out, one leg per direction, and deliberately
 *  one of each cell so the renderer is exercised on both. */
export const transitInput: ChainRenderInput = {
  role: 'transit',
  socksPassword: FIXTURE_SOCKS_PASSWORD,
  in: {
    cred: { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(2), reality: REALITY },
    clients: [
      { tag: 1, uuid: uuidFor(2) },
      { tag: 2, uuid: uuidFor(3) },
    ],
  },
  out: [
    {
      tag: 1,
      host: 'nl-2.example.com',
      cred: { protocol: 'vless', port: LINK_PORT_BASE + 1, uuid: uuidFor(4), reality: REALITY },
    },
    {
      tag: 2,
      host: 'se-2.example.com',
      cred: {
        protocol: 'shadowsocks',
        port: LINK_PORT_BASE + 1,
        psk: FIXTURE_SS_PSK,
        method: '2022-blake3-aes-256-gcm',
      },
    },
  ],
  policy: POLICY,
};

export const exitInput: ChainRenderInput = {
  role: 'exit',
  socksPassword: FIXTURE_SOCKS_PASSWORD,
  in: {
    cred: { protocol: 'vless', port: LINK_PORT_BASE + 1, uuid: uuidFor(4), reality: REALITY },
    clients: [{ tag: 1, uuid: uuidFor(4) }],
  },
  policy: POLICY,
};

const ROLES: readonly (readonly [string, ChainRenderInput])[] = [
  ['entry', entryInput],
  ['transit', transitInput],
  ['exit', exitInput],
];

function engineAccepts(config: unknown): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'iceslab-chain-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  try {
    const out = execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' });
    return { ok: true, output: out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` };
  }
}

describe('the chain config', () => {
  for (const [role, input] of ROLES) {
    it(`matches the golden for the ${role}`, () => {
      const got = `${JSON.stringify(renderChainConfig(input), null, 2)}\n`;
      const path = join(GOLDEN_DIR, `chain-${role}.json`);
      // Retaking a golden is a deliberate act with a flag on it, never a test
      // that quietly rewrites what it is checking: UPDATE_GOLDEN=1 writes the
      // file, and the diff is then read by a human before it is committed.
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(path, got);
        return;
      }
      if (!existsSync(path)) {
        throw new Error(
          `no golden at ${path}. A golden is taken on the first green run, with the ` +
            `engine's own check passing, and read before it is committed.`,
        );
      }
      expect(got).toBe(readFileSync(path, 'utf8'));
    });

    it(`carries every protection rule on the ${role}`, () => {
      // On every role, not only the exit: a transit that forwards port 25 or a
      // torrent handshake has already carried it across a border.
      const cfg = renderChainConfig(input) as { route: { rules: Record<string, unknown>[] } };
      const rules = cfg.route.rules;
      expect(rules[0]).toEqual({ action: 'sniff' });
      expect(rules[1]).toEqual({ protocol: 'dns', action: 'hijack-dns' });
      expect(
        rules.filter((r) => r.action === 'reject' && r.method === 'drop').length,
      ).toBeGreaterThanOrEqual(2);
      expect(rules.some((r) => Array.isArray(r.port) && (r.port as number[]).includes(25))).toBe(
        true,
      );
      expect(rules.some((r) => r.protocol === 'bittorrent')).toBe(true);
      // Sniffing first is load bearing: every rule below that names a domain
      // or a protocol has nothing to match on until it has run.
      expect(rules.findIndex((r) => r.action === 'sniff')).toBe(0);
      // And the protections come before the operator's policy, so no rule of
      // theirs can route port 25 out of an exit.
      const firstPolicy = rules.findIndex((r) => Array.isArray(r.domain_suffix));
      expect(firstPolicy).toBeGreaterThanOrEqual(CHAIN_PROTECTION_RULES);
    });

    it(`writes no block and no dns outbound on the ${role}`, () => {
      /**
       * ⚠ sing-box 1.13 still ACCEPTS a `block` outbound: asked of the binary,
       * and it says yes. So this is OUR rule, not the engine's. Two ways to
       * refuse traffic in one config is how it comes to refuse in two places
       * with two answers, and the rule actions above are the one way.
       */
      const cfg = renderChainConfig(input) as { outbounds: { type: string }[] };
      expect(cfg.outbounds.map((o) => o.type)).not.toContain('block');
      expect(cfg.outbounds.map((o) => o.type)).not.toContain('dns');
    });

    it.skipIf(!SINGBOX_BIN)(`is a config sing-box will load, ${role}`, () => {
      const verdict = engineAccepts(renderChainConfig(input));
      expect(verdict.ok, verdict.output).toBe(true);
    });
  }

  it('gives every way out its own socks port, Auto included', () => {
    const cfg = renderChainConfig(entryInput) as {
      inbounds: { tag: string; listen: string; listen_port: number }[];
    };
    expect(cfg.inbounds.map((i) => i.listen_port)).toEqual([26000, 26001, 26002]);
    // Loopback only. A socks listener on 0.0.0.0 is an open proxy for the
    // whole internet, which is the one mistake this file must never make.
    expect(cfg.inbounds.every((i) => i.listen === '127.0.0.1')).toBe(true);
    expect(chainSocksPort(0)).toBe(26000);
  });

  it('asks every socks listener for a password', () => {
    // On 127.0.0.1 and still authenticated: a VPS has other users, and an
    // unauthenticated proxy on loopback is an open relay for anyone with a
    // shell on that machine.
    const cfg = renderChainConfig(entryInput) as {
      inbounds: { users?: { username: string; password: string }[] }[];
    };
    expect(cfg.inbounds.every((i) => (i.users?.[0]?.password ?? '') !== '')).toBe(true);
  });

  it('routes each way out through its own leg', () => {
    // The reason the fixture has two directions: with one, this passes while
    // checking nothing.
    const cfg = renderChainConfig(entryInput) as { route: { rules: Record<string, unknown>[] } };
    const routed = cfg.route.rules.filter((r) => r.action === 'route' && Array.isArray(r.inbound));
    expect(routed.map((r) => [(r.inbound as string[])[0], r.outbound])).toEqual([
      ['in-d0', 'out-d0'],
      ['in-d1', 'out-d1'],
      ['in-d2', 'out-d2'],
    ]);
  });

  it('tells ways out apart on a transit by the credential they arrived on', () => {
    // A transit sees an internal link, not a user: which credential the
    // traffic came in on is the only thing that says where it was headed.
    const cfg = renderChainConfig(transitInput) as { route: { rules: Record<string, unknown>[] } };
    const byUser = cfg.route.rules.filter((r) => Array.isArray(r.user));
    expect(byUser.map((r) => [(r.user as string[])[0], r.outbound])).toEqual([
      ['lnk-d1', 'out-d1'],
      ['lnk-d2', 'out-d2'],
    ]);
  });

  it('gives the exit nothing to forward to', () => {
    const cfg = renderChainConfig(exitInput) as {
      outbounds: { type: string; tag: string }[];
      route: { rules: Record<string, unknown>[] };
    };
    expect(cfg.outbounds).toEqual([{ type: 'direct', tag: 'direct' }]);
    expect(cfg.route.rules.some((r) => r.action === 'route' && Array.isArray(r.inbound))).toBe(
      false,
    );
  });

  it('keeps the same ways out as the cascade it renders', () => {
    // The semantic half of the golden: bytes change for reasons that do not
    // matter, the SET of ways out is what a subscriber notices. Entry offers
    // exactly the tags it was given, one socks listener and one leg each.
    const cfg = renderChainConfig(entryInput) as {
      inbounds: { tag: string }[];
      outbounds: { tag: string }[];
    };
    expect(cfg.inbounds.map((i) => i.tag)).toEqual(['in-d0', 'in-d1', 'in-d2']);
    expect(cfg.outbounds.map((o) => o.tag)).toEqual(['out-d0', 'out-d1', 'out-d2', 'direct']);
  });
});


