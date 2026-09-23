import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_NAMES, PROTOCOL_NAMES } from '@iceslab/shared';

/**
 * The hand-written mirror between `packages/shared/src/transport.ts` and the
 * agent guards the SHAPE of the wire. It does not guard the COMPOSITION of the
 * enumerations, and TypeScript cannot: JSON arrives parsed as whatever it was
 * declared to be, so a name the agent answers with and the union omits is
 * simply mistyped, silently, forever.
 *
 * That is not hypothetical. `EngineName` shipped as three names on 2026-09-11
 * while four adapters answer `Engine()` with something else (amneziawg, naive,
 * mieru, mtproto). The type lied about the wire from the moment the node began
 * reporting engines, and it was found by reading the Go source by hand.
 *
 * ⚠ WHEN THIS MATTERS: the day a NEW ADAPTER is added to the agent. That is the
 * moment the lists diverge, not some gradual drift, so this test has to exist
 * BEFORE that happens rather than be written after the next one is found.
 *
 * WHAT IT DOES NOT COVER, so nobody gives it a wider reputation than it has:
 *   - unions with no counterpart in Go (RoutingPresetId and friends);
 *   - disagreements of SHAPE rather than composition, which is what the
 *     one-commit rule for transport.ts and dto.go is for;
 *   - protocols the sing-box adapter serves dynamically, see below.
 */
const AGENT_CORES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../apps/node/internal/core',
);

/** Every `adapter.go` under internal/core, read once. */
function adapterSources(): { pkg: string; src: string }[] {
  return readdirSync(AGENT_CORES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ pkg: e.name, path: join(AGENT_CORES, e.name, 'adapter.go') }))
    .filter((e) => {
      try {
        readFileSync(e.path);
        return true;
      } catch {
        // Not every package under core/ is an adapter (subprocess is a helper).
        return false;
      }
    })
    .map((e) => ({ pkg: e.pkg, src: readFileSync(e.path, 'utf8') }));
}

describe('the wire enumerations against the agent that fills them', () => {
  it('names every engine an adapter can answer with', () => {
    // `func (a *Adapter) Engine() string { return "xray" }`, one per adapter.
    const found = new Map<string, string>();
    for (const { pkg, src } of adapterSources()) {
      const m = /func \(a \*Adapter\) Engine\(\) string \{\s*return "([a-z0-9-]+)"/.exec(src);
      if (m) found.set(m[1]!, pkg);
    }

    // If the regex stops matching, this test must FAIL rather than pass on an
    // empty set. A guard that silently checks nothing is worse than none: it
    // reports safety it is not providing. Seven adapters answer today.
    expect(
      found.size,
      'no Engine() method matched, so the shape of the Go source changed and ' +
        'this test is checking nothing. Fix the pattern, do not delete the test.',
    ).toBeGreaterThanOrEqual(7);

    const missing = [...found].filter(([engine]) => !(ENGINE_NAMES as readonly string[]).includes(engine));
    expect(
      missing.map(([engine, pkg]) => `${engine} (${pkg})`),
      'these engines are answered by the agent and missing from EngineName in ' +
        'packages/shared/src/transport.ts, so anything typed as EngineName is ' +
        'lying about what arrives',
    ).toEqual([]);
  });

  it('names every protocol an adapter declares', () => {
    // `const Name = "hysteria"` at package level, one per adapter.
    const found = new Map<string, string>();
    for (const { pkg, src } of adapterSources()) {
      const m = /^const Name = "([a-z0-9-]+)"/m.exec(src);
      if (m) found.set(m[1]!, pkg);
    }
    expect(
      found.size,
      'no `const Name` matched, so the shape of the Go source changed and this ' +
        'test is checking nothing. Fix the pattern, do not delete the test.',
    ).toBeGreaterThanOrEqual(8);

    const missing = [...found].filter(
      ([protocol]) => !(PROTOCOL_NAMES as readonly string[]).includes(protocol),
    );
    expect(
      missing.map(([protocol, pkg]) => `${protocol} (${pkg})`),
      'these protocols are declared by the agent and missing from ProtocolName',
    ).toEqual([]);
  });

  it('does not check the other direction, and here is why', () => {
    // ProtocolName carries anytls and shadowtls, and NO adapter declares them:
    // the sing-box adapter's `const Name` says "tuic" while its Name() returns
    // `a.protocol`, chosen at construction. So "every name in the union is
    // declared by some adapter" is FALSE by design, and asserting it would turn
    // a correct contract into a red test.
    //
    // Kept as a statement rather than a comment on the tests above, because the
    // obvious next edit somebody makes to this file is to add the symmetric
    // check.
    const declaredByNoAdapter = ['anytls', 'shadowtls'];
    for (const p of declaredByNoAdapter) {
      expect(PROTOCOL_NAMES as readonly string[]).toContain(p);
    }
  });
});

/**
 * The `chain` block, key by key, against the Go struct that decodes it.
 *
 * The one-commit rule guards the SHAPE of the wire by asking a human to change
 * both files together. That works when something exercises the pair soon
 * after: a rename breaks a push and somebody notices. This block ships BEFORE
 * anything renders or reads it, by design, so a rename on either side would sit
 * there silently until phase 4 pushed a config the agent decodes into zeroes.
 *
 * So the keys are pinned from here while nothing else can catch them. This is
 * not a general shape checker and does not pretend to be: it reads the JSON
 * tags of two structs and compares them with the names this side sends.
 */
const DTO_GO = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../apps/node/internal/dto/dto.go',
);

/** JSON keys of one Go struct, in declaration order, `omitempty` stripped. */
function jsonKeysOf(struct: string): string[] {
  const src = readFileSync(DTO_GO, 'utf8');
  const body = new RegExp(`type ${struct} struct \\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/`json:"([^",]+)(?:,omitempty)?"`/g)].map((m) => m[1]!);
}

describe('the chain block against the agent that will decode it', () => {
  it('carries the same five keys on both sides', () => {
    const keys = jsonKeysOf('NodeChain');
    // Fails rather than passes empty: if the struct is renamed or the file
    // moves, this test has to say so instead of checking nothing.
    expect(
      keys.length,
      'NodeChain was not found in dto.go, so this test is checking nothing. ' +
        'Fix the pattern or the struct name, do not delete the test.',
    ).toBe(5);
    // `userCore` joined in К6 and is the reason this guard earns its keep: it
    // carries the drawing the user's core renders while the chain process holds
    // the chain, and it ships before anything reads it, so a rename on either
    // side would sit silent until a push decoded into zeroes and an entry
    // quietly egressed from its own country.
    expect(keys).toEqual(['engine', 'config', 'socks', 'socksPassword', 'userCore']);
  });

  it('carries every user-core key on both sides', () => {
    // A union by engine since phase 6: xray carries `fragments`, a hysteria
    // entry carries `socks`. Go has no sum type, so the agent holds both halves
    // as optional fields and refuses a block whose halves do not match its
    // engine. A key renamed on one side would decode into an empty half, and an
    // empty half on a hysteria entry is a core with no hand-off: every user out
    // of the entry country with a working connection.
    expect(jsonKeysOf('ChainUserCore')).toEqual(['engine', 'fragments', 'socks']);
  });

  it('carries the three hand-off keys on both sides', () => {
    // A PORT, not an address: the agent writes 127.0.0.1 itself. If this ever
    // grows an `addr`, that is a panel able to point hysteria's users at any
    // machine it likes, and it should be a decision, not a drift.
    expect(jsonKeysOf('ChainUserCoreSocks')).toEqual(['port', 'username', 'password']);
  });

  it('carries both socks keys on both sides', () => {
    expect(jsonKeysOf('ChainSocks')).toEqual(['tag', 'port']);
  });

  it('answers with the same four keys as the panel reads back', () => {
    // The other direction of the same block: what the agent SAYS about its
    // chain. `reservedPorts` moved in here from a core's list on 2026-09-22,
    // because reporting them there said "xray holds 26000" about a port the
    // chain holds; the panel's port check reads this key by name.
    expect(jsonKeysOf('ChainStatusDto')).toEqual([
      'running',
      'version',
      'error',
      'reservedPorts',
    ]);
  });

  it('keeps the block optional on the request, beside the cascade it replaces', () => {
    // Optional on the wire is what lets it ship before anything reads it, and
    // what lets an older agent keep running on `cascade` through the one
    // transitional release when both travel.
    const src = readFileSync(DTO_GO, 'utf8');
    const req = /type ApplyInboundsRequest struct \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(req).toContain('`json:"chain,omitempty"`');
    expect(req).toContain('`json:"cascade,omitempty"`');
  });
});
