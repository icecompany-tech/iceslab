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
