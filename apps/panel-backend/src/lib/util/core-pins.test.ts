import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_COMPONENTS, CORE_VERSIONS, type CoreComponent } from '@iceslab/shared';
import {
  PIN_PREFIX,
  PIN_SITES,
  blockEnd,
  blockStart,
  readPinBlock,
  renderPinBlock,
  writePinBlock,
} from './core-pins.js';

/**
 * The installers' pins against the version manifest.
 *
 * Before the manifest every script held its own number and a Go test held a
 * second copy of each (xray's twice), so moving a pin meant finding every copy
 * by hand. Now the scripts carry a block generated from the manifest, and this
 * is the test that says when a block and the manifest disagree.
 *
 * To move a pin: edit packages/shared/src/core-versions.ts, then run
 *   UPDATE_CORE_PINS=1 node ./node_modules/vitest/vitest.mjs run src/lib/util/core-pins.test.ts
 * and commit the manifest and the rewritten scripts together.
 *
 * ⚠ The update mode writes into the scripts. Run it on purpose, never in CI.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const UPDATE = process.env.UPDATE_CORE_PINS === '1';

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

if (UPDATE) {
  for (const site of PIN_SITES) {
    let text = read(site.file);
    for (const c of site.components) text = writePinBlock(text, c);
    writeFileSync(join(ROOT, site.file), text);
  }
}

describe('every installer carries the manifest, byte for byte', () => {
  const cases = PIN_SITES.flatMap((s) => s.components.map((c) => [s.file, c] as const));

  it.each(cases)('%s: %s', (file, component) => {
    const text = read(file);
    expect(text.split(blockStart(component)).length - 1, 'exactly one block').toBe(1);
    expect(text.split(blockEnd(component)).length - 1, 'exactly one block').toBe(1);
    expect(readPinBlock(text, component)).toBe(renderPinBlock(component));
  });

  it('every pinned component reaches at least one installer', () => {
    const reached = new Set(PIN_SITES.flatMap((s) => s.components));
    const pinned = CORE_COMPONENTS.filter((c) => CORE_VERSIONS[c].pinned !== null);
    expect(pinned.filter((c) => !reached.has(c))).toEqual([]);
  });
});

describe('no hand-written copy of a pin is left beside its block', () => {
  // The copies are what this replaces: a default like XRAY_VERSION=v26.3.27
  // outside the block would still win, and nothing would say it went stale.
  const outsideBlocks = (text: string, components: CoreComponent[]) => {
    let rest = text;
    for (const c of components) {
      const block = readPinBlock(rest, c);
      if (block) rest = rest.replace(block, '');
    }
    return rest;
  };

  it.each(PIN_SITES.map((s) => [s.file, s.components] as const))('%s', (file, components) => {
    const rest = outsideBlocks(read(file), components);
    for (const c of components) {
      const { version } = CORE_VERSIONS[c].releases.find((r) => r.version === CORE_VERSIONS[c].pinned)!;
      const escaped = version.replace(/\./g, '\\.');
      const assignment = new RegExp(`^\\s*[A-Z_]+=.*\\bv?${escaped}\\b`, 'm');
      expect(rest, `${c}: an assignment outside the block names ${version}`).not.toMatch(assignment);
      expect(rest, `${c}: the pinned version is assigned outside the block`).not.toMatch(
        new RegExp(`^\\s*${PIN_PREFIX[c]}_PINNED_`, 'm'),
      );
    }
  });
});

describe('CI asks the engine the fleet runs, checked by the same sha256', () => {
  // The config-validity tests download xray, sing-box and hysteria. A CI on
  // another release answers for an engine no node runs: green in CI, refused on
  // the fleet.
  const ci = read('.github/workflows/ci.yml');

  it.each(['xray', 'singbox', 'hysteria'] as const)('%s', (c) => {
    const entry = CORE_VERSIONS[c];
    const release = entry.releases.find((r) => r.version === entry.pinned)!;
    const asset = release.assets!.amd64!;
    const tag = release.tag.replace('/', '%2F');
    expect(ci).toContain(`releases/download/${tag}/${asset.file}`);
    expect(ci).toContain(`${asset.sha256}  `);
  });
});
