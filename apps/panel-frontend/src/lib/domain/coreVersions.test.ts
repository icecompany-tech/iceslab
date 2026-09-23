import { describe, expect, it } from 'vitest';
import { CORE_COMPONENTS, CORE_VERSIONS } from '@iceslab/shared';
import { CORE_UPDATE, coreUpdateCommand, coreVersionFacts } from '@/lib/domain/coreVersions';
import type { NodeCore } from '@/lib/domain/nodes';

const core = (c: Partial<NodeCore> & { name: NodeCore['name'] }): NodeCore => c as NodeCore;
const PIN = (c: keyof typeof CORE_VERSIONS) => CORE_VERSIONS[c].pinned!;
const SHA = (c: keyof typeof CORE_VERSIONS, arch: 'amd64' | 'arm64' | 'armv7') =>
  CORE_VERSIONS[c].releases.find((r) => r.version === PIN(c))!.assets![arch]!.sha256;
const line = (p: string, v: string, sha: string, script: string) =>
  `sudo env ${p}_VERSION=${v} ${p}_SHA256=${sha} bash /opt/iceslab-node/apps/node/scripts/${script} && sudo systemctl restart iceslab-node`;

describe('coreVersionFacts: one line per verdict', () => {
  it('intended, and the pin: no command', () => {
    const [l] = coreVersionFacts(core({ name: 'xray', engine: 'xray', version: PIN('xray') }), 'amd64');
    expect(l).toMatchObject({ component: 'xray', part: null, verdict: { kind: 'intended', isPin: true }, command: null });
  });

  it('drift: both numbers, and the version with its checksum for this arch', () => {
    const [l] = coreVersionFacts(core({ name: 'tuic', engine: 'singbox', version: '1.13.12' }), 'arm64');
    expect(l?.verdict).toEqual({ kind: 'drift', intended: PIN('singbox') });
    expect(l?.command).toEqual({
      kind: 'command',
      text: line('SINGBOX', PIN('singbox'), SHA('singbox', 'arm64'), 'bootstrap-singbox.sh'),
    });
  });

  it('above the ceiling and known bad on xray: a command through bootstrap-xray.sh now', () => {
    for (const v of ['26.8.1', '26.9.8']) {
      const [l] = coreVersionFacts(core({ name: 'xray', engine: 'xray', version: v }), 'amd64');
      expect(['above-ceiling', 'known-bad']).toContain(l?.verdict.kind);
      expect(l?.command).toEqual({ kind: 'command', text: line('XRAY', PIN('xray'), SHA('xray', 'amd64'), 'bootstrap-xray.sh') });
    }
  });

  it('no arch reported: the verdict stands, the command does not', () => {
    const [l] = coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '26.9.8' }), undefined);
    expect(l?.verdict.kind).toBe('known-bad');
    expect(l?.command).toEqual({ kind: 'none', why: 'no-arch' });
  });

  it('unpinned: the reason, and no command to offer', () => {
    const [l] = coreVersionFacts(core({ name: 'naive', engine: 'naive', version: '2.10.0' }), 'amd64');
    expect(l?.verdict.kind).toBe('unpinned');
    expect(l?.command).toBeNull();
  });

  it('unknown stays silent: empty, garbage, or no field', () => {
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '' }), 'amd64')).toEqual([]);
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray', version: 'dev-build' }), 'amd64')).toEqual([]);
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray' }), 'amd64')).toEqual([]);
  });

  it('a missing binary is not judged, whatever version rode along', () => {
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '26.9.8', installed: false }), 'amd64')).toEqual([]);
  });

  it('AmneziaWG: module and tools are two lines in one row; empty tools stay silent', () => {
    const one = coreVersionFacts(core({ name: 'amneziawg', engine: 'amneziawg', version: PIN('amneziawg-module') }), 'amd64');
    expect(one.map((l) => l.part)).toEqual(['module']);
    const two = coreVersionFacts(
      core({ name: 'amneziawg', engine: 'amneziawg', version: PIN('amneziawg-module'), toolsVersion: PIN('amneziawg-tools') }),
      'amd64',
    );
    expect(two.map((l) => [l.part, l.verdict.kind])).toEqual([
      ['module', 'intended'],
      ['tools', 'intended'],
    ]);
  });

  it('an engine row with no engine field is read by its name (older agent)', () => {
    expect(coreVersionFacts(core({ name: 'hysteria', version: PIN('hysteria') }), 'amd64')[0]?.component).toBe('hysteria');
  });
});

describe('coreUpdateCommand', () => {
  it('one form for every script: the release version as it is, no tag, no leading v', () => {
    const c = coreUpdateCommand('hysteria', PIN('hysteria'), 'amd64');
    expect(c).toEqual({ kind: 'command', text: line('HYSTERIA', PIN('hysteria'), SHA('hysteria', 'amd64'), 'bootstrap-hysteria.sh') });
  });

  it('mtg and mita get a command now that the arch is known', () => {
    expect(coreUpdateCommand('mtg', PIN('mtg'), 'armv7')).toEqual({
      kind: 'command',
      text: line('MTG', PIN('mtg'), SHA('mtg', 'armv7'), 'bootstrap-mtg.sh'),
    });
  });

  it('a release with no build for the arch (mita on armv7) has no command, and says why', () => {
    expect(coreUpdateCommand('mita', PIN('mita'), 'armv7')).toEqual({ kind: 'none', why: 'no-asset' });
  });

  it('a version the manifest does not list, and AmneziaWG, have no command', () => {
    expect(coreUpdateCommand('mtg', '9.9.9', 'amd64')).toEqual({ kind: 'none', why: 'unpinned' });
    expect(coreUpdateCommand('amneziawg-module', PIN('amneziawg-module'), 'amd64')).toEqual({
      kind: 'none',
      why: 'skips-installed',
    });
  });

  it('through sudo env and bash: sudo resets the environment, the scripts have no executable bit', () => {
    const c = coreUpdateCommand('singbox', PIN('singbox'), 'amd64');
    expect(c.kind === 'command' && /^sudo env SINGBOX_VERSION=\S+ SINGBOX_SHA256=[0-9a-f]{64} bash \//.test(c.text)).toBe(true);
  });
});

// The dictionary against the scripts it names: a renamed script, a renamed
// variable or a pin that moved in one place and not the other fails here.
const SCRIPTS = import.meta.glob('../../../../node/scripts/bootstrap-*.sh', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('CORE_UPDATE against apps/node/scripts', () => {
  it('reads the scripts, not nothing', () => {
    expect(Object.keys(SCRIPTS).length).toBeGreaterThanOrEqual(6);
  });

  it('every script named exists, takes both variables of its pair, and defaults to the manifest pin', () => {
    for (const component of CORE_COMPONENTS) {
      const how = CORE_UPDATE[component];
      if (typeof how === 'string') continue;
      const path = Object.keys(SCRIPTS).find((p) => p.endsWith(`/${how.script}`));
      expect(path, `${component}: ${how.script}`).toBeDefined();
      const src = SCRIPTS[path!]!;
      expect(src, `${component}: ${how.prefix}_VERSION`).toMatch(new RegExp(`\\$\\{${how.prefix}_VERSION[:}]`));
      expect(src, `${component}: ${how.prefix}_SHA256`).toMatch(new RegExp(`\\$\\{${how.prefix}_SHA256[:}]`));
      expect(src, `${component}: pin ${PIN(component)}`).toContain(PIN(component));
    }
  });
});
