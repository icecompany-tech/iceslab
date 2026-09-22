import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderChainConfig, type ChainRenderInput } from './chain.config.js';
import { LINK_PORT_BASE, type LinkCred } from './cascade.config.js';

/**
 * The two ends of a REALITY leg, checked AGAINST EACH OTHER.
 *
 * ⚠ Two green `sing-box check` runs do not prove a leg works, and this file
 * exists because that was believed once already. The hardening of 2026-08
 * shipped, passed its tests and never carried a packet: the tests built
 * fragments from a credential in memory, the renderers read the column, and the
 * column never had the block. Structure was asked; agreement was not.
 *
 * MEASURED against sing-box 1.13.14 on 2026-09-22, and each of these is a way a
 * pair can pass `check` and still complete no handshake:
 *
 *   - an inbound with NO `handshake` block is accepted. A leg with a missing
 *     camouflage target is a config error nothing reports;
 *   - `flow: xtls-rprx-vision` on an outbound whose TLS is off is accepted.
 *     The server rejects such a client at the handshake, not at load;
 *   - `short_id` is a LIST on an inbound and a STRING on an outbound
 *     ("cannot unmarshal array into ... short_id of type string"), so the two
 *     sides cannot even be compared field for field without knowing that;
 *   - an outbound without `utls` is refused outright ("uTLS is required by
 *     reality client"), which is the one of the four `check` does catch;
 *   - a short id of odd length is refused ("odd length hex string").
 *
 * So every test below renders BOTH ends from ONE credential and compares them.
 */
const SINGBOX_BIN =
  process.env.SINGBOX_BIN ??
  ['/usr/local/bin/sing-box', '/usr/bin/sing-box'].find((p) => existsSync(p)) ??
  '';

const uuidFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * The keypair of the RECEIVING NODE, and a short id per leg.
 *
 * Not one keypair per leg: a node has one listener for the whole step and the
 * engine takes one `private_key` on it. The fixture therefore looks the way a
 * save will write it, two legs of one step sharing the pair.
 */
const NODE_REALITY = {
  privateKey: 'cKY7A3fWsrXqyFGpJ5PfBFRq7Fm3nJjRO_Z1qk0UEm8',
  publicKey: 'jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0',
  serverName: 'www.microsoft.com',
  dest: 'www.microsoft.com:443',
};

const legFor = (n: number, shortId: string): LinkCred => ({
  protocol: 'vless',
  port: LINK_PORT_BASE,
  uuid: uuidFor(n),
  reality: { ...NODE_REALITY, shortId },
});

const NL_LEG = legFor(1, '0123abcd');
const SE_LEG = legFor(2, '89ab0000');

/** The node the two legs land on: one listener, two directions. */
const receiver: ChainRenderInput = {
  role: 'exit',
  socksPassword: 'chain-socks-fixture-password-0000',
  in: {
    cred: NL_LEG,
    clients: [
      { tag: 1, uuid: uuidFor(1), shortId: '0123abcd' },
      { tag: 2, uuid: uuidFor(2), shortId: '89ab0000' },
    ],
  },
};

/** The node that dials one of them. */
const dialler: ChainRenderInput = {
  role: 'entry',
  socksPassword: 'chain-socks-fixture-password-0000',
  directionTags: [1, 2],
  out: [
    { tag: 1, host: 'exit.example.com', cred: NL_LEG },
    { tag: 2, host: 'exit.example.com', cred: SE_LEG },
  ],
};

interface RealityInbound {
  users: { uuid: string; flow?: string }[];
  tls: {
    server_name: string;
    reality: {
      handshake: { server: string; server_port: number };
      private_key: string;
      short_id: string[];
    };
  };
}

interface RealityOutbound {
  flow?: string;
  tls: {
    server_name: string;
    utls?: { enabled: boolean; fingerprint: string };
    reality: { public_key: string; short_id: string };
  };
}

const inboundOf = (cfg: Record<string, unknown>) =>
  (cfg.inbounds as Record<string, unknown>[]).find((i) => i.tag === 'link-in') as unknown as
    | RealityInbound
    | undefined;

const outboundsOf = (cfg: Record<string, unknown>) =>
  (cfg.outbounds as Record<string, unknown>[]).filter(
    (o) => o.type === 'vless',
  ) as unknown as RealityOutbound[];

function engineAccepts(config: unknown): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'iceslab-reality-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  try {
    return { ok: true, output: execFileSync(SINGBOX_BIN, ['check', '-c', file], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` };
  }
}

describe('a REALITY leg of the chain, both ends', () => {
  const listener = inboundOf(renderChainConfig(receiver) as Record<string, unknown>)!;
  const diallers = outboundsOf(renderChainConfig(dialler) as Record<string, unknown>);

  it('puts the node key on the listener and every leg key beside it', () => {
    expect(listener.tls.reality.private_key).toBe(NODE_REALITY.privateKey);
    // Both, not the first. Rendering one short id silently drops every other
    // direction arriving on the same step, and the leg that was dropped is the
    // one nobody tested.
    expect(listener.tls.reality.short_id).toEqual(['0123abcd', '89ab0000']);
  });

  it('gives each dialler the public half and its own short id, as a string', () => {
    expect(diallers).toHaveLength(2);
    for (const out of diallers) {
      expect(out.tls.reality.public_key).toBe(NODE_REALITY.publicKey);
      expect(typeof out.tls.reality.short_id).toBe('string');
    }
    expect(diallers.map((o) => o.tls.reality.short_id).sort()).toEqual(['0123abcd', '89ab0000']);
  });

  it('agrees on the short id: every dialler is named by the listener', () => {
    // The cross-check the 2026-08 hardening never had. A dialler holding a
    // short id the listener does not list is refused at the handshake, and both
    // configs load cleanly.
    for (const out of diallers) {
      expect(listener.tls.reality.short_id).toContain(out.tls.reality.short_id);
    }
  });

  it('agrees on the name and the camouflage target', () => {
    expect(listener.tls.server_name).toBe(NODE_REALITY.serverName);
    expect(listener.tls.reality.handshake).toEqual({ server: 'www.microsoft.com', server_port: 443 });
    for (const out of diallers) expect(out.tls.server_name).toBe(NODE_REALITY.serverName);
  });

  it('names the flow on both ends or on neither', () => {
    // VISION is per user. The dialling side used to name it unconditionally
    // while the listener named it for nobody, which is a pair that loads and
    // never completes a handshake.
    for (const user of listener.users) expect(user.flow).toBe('xtls-rprx-vision');
    for (const out of diallers) expect(out.flow).toBe('xtls-rprx-vision');

    const plainLeg: LinkCred = { protocol: 'vless', port: LINK_PORT_BASE, uuid: uuidFor(9) };
    const plainIn = inboundOf(
      renderChainConfig({ ...receiver, in: { cred: plainLeg, clients: [{ tag: 1 }] } }) as Record<
        string,
        unknown
      >,
    )!;
    const plainOut = outboundsOf(
      renderChainConfig({
        ...dialler,
        out: [{ tag: 1, host: 'exit.example.com', cred: plainLeg }],
      }) as Record<string, unknown>,
    );
    for (const user of plainIn.users) expect(user.flow).toBeUndefined();
    for (const out of plainOut) expect(out.flow).toBeUndefined();
  });

  it('carries the uTLS the engine demands of a reality client', () => {
    // MEASURED: without it sing-box refuses the outbound outright. One of the
    // four traps that `check` does catch, and the only one.
    for (const out of diallers) {
      expect(out.tls.utls).toEqual({ enabled: true, fingerprint: 'firefox' });
    }
  });

  it('uses short ids of even length, because hex pairs are the rule', () => {
    // MEASURED: "decode short_id[0]: encoding/hex: odd length hex string".
    // The panel mints 8 bytes as hex, so this holds by construction and is
    // pinned because the construction is one edit away from a slice.
    for (const id of listener.tls.reality.short_id) {
      expect(id.length % 2, `${id} is not whole bytes`).toBe(0);
      expect(id).toMatch(/^[0-9a-f]+$/);
    }
  });

  it.runIf(SINGBOX_BIN)('is accepted by the engine at both ends', () => {
    for (const [name, input] of [
      ['receiver', receiver],
      ['dialler', dialler],
    ] as const) {
      const res = engineAccepts(renderChainConfig(input));
      expect(res.ok, `${name}: ${res.output}`).toBe(true);
    }
  });
});
