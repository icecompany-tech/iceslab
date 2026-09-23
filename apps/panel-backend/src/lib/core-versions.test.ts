import { describe, it, expect } from 'vitest';
import {
  CORE_COMPONENTS,
  CORE_VERSIONS,
  ENGINE_NAMES,
  checkCoreVersionIntent,
  compareCoreVersions,
  judgeCoreVersion,
  normalizeCoreVersion,
  resolveCoreVersions,
  type CoreComponent,
} from '@iceslab/shared';

/**
 * The version manifest (packages/shared/src/core-versions.ts) is read by the
 * installers, the panel's gates and the node card. These hold the list to its
 * own rules and pin how a reported version is judged, so the three readers
 * cannot come to different answers about the same number.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

describe('the manifest keeps its own rules', () => {
  it.each(CORE_COMPONENTS)('%s: the pin is a listed release, in the manifest form', (c) => {
    const e = CORE_VERSIONS[c];
    if (e.pinned === null) {
      expect(e.unpinnedReason, 'an unpinned component says why').toBeTruthy();
      return;
    }
    expect(normalizeCoreVersion(e.pinned)).toBe(e.pinned);
    expect(e.releases.map((r) => r.version)).toContain(e.pinned);
  });

  it.each(CORE_COMPONENTS)('%s: every release is checkable, by sha256 or by commit', (c) => {
    for (const r of CORE_VERSIONS[c].releases) {
      expect(normalizeCoreVersion(r.version)).toBe(r.version);
      expect(Boolean(r.assets) !== Boolean(r.commit), `${r.version}: exactly one of assets/commit`).toBe(true);
      if (r.commit) expect(r.commit).toMatch(HEX40);
      if (r.assets) {
        const assets = Object.values(r.assets);
        expect(assets.length).toBeGreaterThan(0);
        for (const a of assets) {
          expect(a.sha256).toMatch(HEX64);
          expect(a.file).toBeTruthy();
        }
      }
      expect(r.why).toBeTruthy();
      expect(r.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it.each(CORE_COMPONENTS)('%s: no listed release is known-bad or over the ceiling', (c) => {
    for (const r of CORE_VERSIONS[c].releases) {
      const v = judgeCoreVersion(c, r.version, { [c]: r.version });
      expect(v.kind, `${c} ${r.version}`).toBe('intended');
    }
  });

  it('every known-bad range has an end, and every mark a reason', () => {
    for (const c of CORE_COMPONENTS) {
      const e = CORE_VERSIONS[c];
      for (const bad of e.knownBad) {
        expect(bad.from !== undefined || bad.before !== undefined).toBe(true);
        expect(bad.reason).toBeTruthy();
      }
      if (e.ceiling) expect(e.ceiling.reason).toBeTruthy();
    }
  });

  it('every engine a node can report has its version judged by some component', () => {
    const covered = new Set(CORE_COMPONENTS.map((c) => CORE_VERSIONS[c].reportedBy.engine));
    expect([...covered].sort()).toEqual([...ENGINE_NAMES].sort());
  });

  it('the tools field is AmneziaWG only, beside its module', () => {
    const tools = CORE_COMPONENTS.filter((c) => CORE_VERSIONS[c].reportedBy.field === 'toolsVersion');
    expect(tools).toEqual(['amneziawg-tools']);
  });

  it('hysteria armv7 names the file upstream actually ships', () => {
    // There is no hysteria-linux-armv7; bootstrap-hysteria.sh asked for it.
    expect(CORE_VERSIONS.hysteria.releases[0]!.assets!.armv7!.file).toBe('hysteria-linux-arm');
  });
});

describe('compareCoreVersions', () => {
  it.each([
    ['26.3.27', '26.3.27', 0],
    ['v26.3.27', '26.3.27', 0],
    ['1.0', '1.0.0', 0],
    ['26.3.27', '26.7.28', -1],
    ['26.10.1', '26.9.8', 1],
    ['1.0.20260611', '2', -1],
    ['3.1.20260812', '2', 1],
  ] as const)('%s vs %s = %s', (a, b, want) => {
    expect(compareCoreVersions(a, b)).toBe(want);
  });

  it('will not order two versions that differ only in a suffix', () => {
    // semver puts "-2" before the bare version, amneziawg-tools after it.
    expect(compareCoreVersions('1.0.20260618-2', '1.0.20260618')).toBeUndefined();
    expect(compareCoreVersions('1.14.0-beta.1', '1.14.0')).toBeUndefined();
  });

  it('will not order what is not a version', () => {
    expect(compareCoreVersions('d2758a0', '26.3.27')).toBeUndefined();
  });
});

describe('judgeCoreVersion', () => {
  const cases: [CoreComponent, string | null | undefined, string][] = [
    ['xray', '26.3.27', 'intended'],
    ['xray', 'v26.3.27', 'intended'],
    ['xray', '26.7.28', 'drift'],
    ['xray', '26.8.1', 'above-ceiling'],
    ['xray', '26.9.8', 'known-bad'],
    ['xray', '27.0.0', 'known-bad'],
    ['xray', '25.9.5', 'drift'],
    ['xray', '', 'unknown'],
    ['xray', null, 'unknown'],
    ['xray', undefined, 'unknown'],
    ['xray', 'd2758a0', 'unknown'],
    ['amneziawg-module', '1.0.20260611', 'intended'],
    ['amneziawg-module', '1.0.0', 'drift'],
    ['amneziawg-module', '3.1.20260906', 'known-bad'],
    ['amneziawg-tools', '1.0.20260618-2', 'intended'],
    // The bare tag is another commit, not a worse version: drift, never bad.
    ['amneziawg-tools', '1.0.20260618', 'drift'],
    ['amneziawg-tools', '3.1.20260812', 'known-bad'],
    ['caddy-naive', '2.8.4', 'unpinned'],
    ['singbox', '1.13.14', 'intended'],
    ['hysteria', '2.12.3', 'intended'],
    ['mtg', '2.2.8', 'intended'],
    ['mita', '3.37.0', 'intended'],
  ];
  it.each(cases)('%s %s is %s', (component, reported, kind) => {
    expect(judgeCoreVersion(component, reported).kind).toBe(kind);
  });

  it('says whether the intended version is the pin', () => {
    expect(judgeCoreVersion('xray', '26.3.27')).toEqual({ kind: 'intended', isPin: true });
  });

  it('names what a drifted node should be running', () => {
    expect(judgeCoreVersion('xray', '26.7.28')).toEqual({ kind: 'drift', intended: '26.3.27' });
  });

  it('carries the reason with a known-bad verdict', () => {
    const v = judgeCoreVersion('xray', '26.9.8');
    expect(v.kind === 'known-bad' && v.reason).toMatch(/MLKEM/);
  });
});

describe('intent and the bootstrap payload', () => {
  it('an empty intent resolves to the pins, with no component that has none', () => {
    const r = resolveCoreVersions();
    for (const c of CORE_COMPONENTS) {
      const pinned = CORE_VERSIONS[c].pinned;
      if (pinned === null) expect(r[c]).toBeUndefined();
      else expect(r[c]?.version).toBe(pinned);
    }
  });

  it('the payload carries what an installer needs and nothing it does not', () => {
    const r = resolveCoreVersions();
    expect(Object.keys(r.xray!).sort()).toEqual(['assets', 'tag', 'version']);
    expect(Object.keys(r['amneziawg-module']!).sort()).toEqual(['commit', 'tag', 'version']);
    expect(r.hysteria!.tag).toBe('app/v2.12.3');
  });

  it('refuses a version the manifest does not list, naming what it does', () => {
    expect(checkCoreVersionIntent({ xray: '26.7.28' })).toEqual([
      'xray: 26.7.28 is not a listed release (26.3.27)',
    ]);
    expect(checkCoreVersionIntent({ 'caddy-naive': '2.8.4' })).toEqual([
      'caddy-naive: nothing is listed to choose from',
    ]);
    expect(checkCoreVersionIntent({ nginx: '1.0' } as never)).toEqual(['nginx: not a core component']);
    expect(checkCoreVersionIntent({ xray: '26.3.27' })).toEqual([]);
  });

  it('fails loudly on an intent that stopped being valid, rather than handing out the pin', () => {
    expect(() => resolveCoreVersions({ xray: '26.7.28' })).toThrow(/xray: 26\.7\.28/);
  });
});
