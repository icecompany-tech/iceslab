import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_NAMES } from '@iceslab/shared';

/**
 * The list of formats against the code that serves them.
 *
 * There were three lists. The subscription route accepted thirteen names, the
 * host schema eleven (missing `xrayjson-array` and `amneziavpn`, carrying
 * `mieru-json` which nothing has ever served), and the frontend's host editor
 * offered five of its own. An operator picking a format the editor showed got a
 * 400 from a schema that had never heard of it, and no screen could explain
 * why (issue #41).
 *
 * One list now, in shared. What this file holds is that the list stays TRUE:
 * a name nothing serves is as bad as a served format nobody may name, and
 * neither shows up in a type check, because both sides are strings on the wire.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '..', 'subscription.routes.ts');

describe('the format list against what serves it', () => {
  it('has every builder reachable by a name', () => {
    const builders = readdirSync(HERE)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => f.replace(/\.ts$/, ''));
    // Fails rather than passes empty: a glob that finds nothing would make
    // every assertion below vacuous, which is the failure mode of this whole
    // class of test.
    expect(builders.length, 'no format builders found, so this test checks nothing').toBeGreaterThan(
      5,
    );
    for (const builder of builders) {
      expect(
        FORMAT_NAMES as readonly string[],
        `${builder}.ts builds a format no name reaches`,
      ).toContain(builder);
    }
  });

  it('has every name handled by the route', () => {
    // The other direction, and the one that produced the bug: a name accepted
    // by a schema and handled nowhere is a 200 with the wrong body, or a fall
    // through to plain. Read off the switch rather than exercised through it,
    // because thirteen live requests to prove a switch is a slow way to say
    // one thing.
    const src = readFileSync(ROUTES, 'utf8');
    const handled = new Set([...src.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!));
    expect(handled.size, 'no cases found in the route, so this test checks nothing').toBeGreaterThan(
      5,
    );
    for (const name of FORMAT_NAMES) {
      expect(handled, `the route has no case for ${name}`).toContain(name);
    }
  });

  it('builds every file from the gated list, never from the raw one', () => {
    // FORMAT_DOORS is one decision with the files only while every builder is
    // handed endpointsForFormat's output (`served`). A builder call on the raw
    // list would put back the per-builder literals the table replaced.
    const src = readFileSync(ROUTES, 'utf8');
    const start = src.indexOf('switch (format) {');
    const end = src.indexOf("case 'plain':", start);
    expect(start, 'the format switch is not where this test looks').toBeGreaterThan(0);
    const block = src.slice(start, end);
    const args = [...block.matchAll(/build\w+\((\w+)/g)].map((m) => m[1]);
    expect(args.length, 'no builder calls found in the switch').toBeGreaterThan(8);
    expect(new Set(args)).toEqual(new Set(['served']));
    expect(block).toContain('endpoints: served');
  });

  it('is the same list the host schema takes', () => {
    // Both schemas read FORMAT_NAMES now; this is the guard against somebody
    // pasting a literal back in. `mieru-json` is named because it is what the
    // host schema used to carry alone, and its return would be silent.
    const hosts = readFileSync(join(HERE, '..', '..', 'hosts', 'hosts.schemas.ts'), 'utf8');
    expect(hosts).toContain('z.enum(FORMAT_NAMES)');
    expect(hosts).not.toContain("'mieru-json'");
  });
});
