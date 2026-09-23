import { describe, expect, it } from 'vitest';
import { CORE_COMPONENTS, CORE_VERSIONS } from '@iceslab/shared';
import { CORE_UPDATE, coreUpdateCommand, coreVersionFacts } from '@/lib/domain/coreVersions';
import type { NodeCore } from '@/lib/domain/nodes';

const core = (c: Partial<NodeCore> & { name: NodeCore['name'] }): NodeCore => c as NodeCore;
const PIN = (c: keyof typeof CORE_VERSIONS) => CORE_VERSIONS[c].pinned!;

describe('coreVersionFacts: one line per verdict', () => {
  it('intended, and the pin: no command', () => {
    const [l] = coreVersionFacts(core({ name: 'xray', engine: 'xray', version: PIN('xray') }));
    expect(l).toMatchObject({ component: 'xray', part: null, verdict: { kind: 'intended', isPin: true }, command: null });
  });

  it('drift: both numbers, and the line that moves it to the pin (sing-box takes the tag)', () => {
    const [l] = coreVersionFacts(core({ name: 'tuic', engine: 'singbox', version: '1.13.12' }));
    expect(l?.verdict).toEqual({ kind: 'drift', intended: PIN('singbox') });
    expect(l?.command).toEqual({
      kind: 'command',
      text: `sudo env SINGBOX_VERSION=v${PIN('singbox')} /opt/iceslab-node/apps/node/scripts/bootstrap-singbox.sh && sudo systemctl restart iceslab-node`,
    });
  });

  it('above the ceiling: the ceiling and its reason; xray has no script, and says so', () => {
    const [l] = coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '26.8.1' }));
    expect(l?.verdict.kind).toBe('above-ceiling');
    expect(l?.command).toEqual({ kind: 'none', why: 'no-script' });
  });

  it('known bad beats everything else', () => {
    const [l] = coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '26.9.8' }));
    expect(l?.verdict.kind).toBe('known-bad');
  });

  it('unpinned: the reason, and no command to offer', () => {
    const [l] = coreVersionFacts(core({ name: 'naive', engine: 'naive', version: '2.10.0' }));
    expect(l?.verdict.kind).toBe('unpinned');
    expect(l?.command).toBeNull();
  });

  it('unknown stays silent: empty, garbage, or no field', () => {
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '' }))).toEqual([]);
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray', version: 'dev-build' }))).toEqual([]);
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray' }))).toEqual([]);
  });

  it('a missing binary is not judged, whatever version rode along', () => {
    expect(coreVersionFacts(core({ name: 'xray', engine: 'xray', version: '26.9.8', installed: false }))).toEqual([]);
  });

  it('AmneziaWG: module and tools are two lines in one row; empty tools stay silent', () => {
    const one = coreVersionFacts(core({ name: 'amneziawg', engine: 'amneziawg', version: PIN('amneziawg-module') }));
    expect(one.map((l) => l.part)).toEqual(['module']);
    const two = coreVersionFacts(
      core({ name: 'amneziawg', engine: 'amneziawg', version: PIN('amneziawg-module'), toolsVersion: PIN('amneziawg-tools') }),
    );
    expect(two.map((l) => [l.part, l.verdict.kind])).toEqual([
      ['module', 'intended'],
      ['tools', 'intended'],
    ]);
  });

  it('an engine row with no engine field is read by its name (older agent)', () => {
    expect(coreVersionFacts(core({ name: 'hysteria', version: PIN('hysteria') }))[0]?.component).toBe('hysteria');
  });
});

describe('coreUpdateCommand', () => {
  it('hysteria gets v + version, never its tag "app/v…" (that breaks the download URL)', () => {
    const c = coreUpdateCommand('hysteria', PIN('hysteria'));
    expect(c).toMatchObject({ kind: 'command' });
    expect(c.kind === 'command' && c.text).toContain(`HYSTERIA_VERSION=v${PIN('hysteria')} `);
  });

  it('mtg and mita name only the script\'s pin: another version needs a checksum the panel does not have', () => {
    expect(coreUpdateCommand('mtg', PIN('mtg'))).toEqual({
      kind: 'command',
      text: 'sudo /opt/iceslab-node/apps/node/scripts/bootstrap-mtg.sh && sudo systemctl restart iceslab-node',
    });
    expect(coreUpdateCommand('mtg', '9.9.9')).toEqual({ kind: 'none', why: 'unpinned' });
  });

  it('the variable goes through sudo env, not in front of sudo (sudo resets the environment)', () => {
    const c = coreUpdateCommand('singbox', PIN('singbox'));
    expect(c.kind === 'command' && c.text.startsWith('sudo env SINGBOX_VERSION=')).toBe(true);
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
    expect(Object.keys(SCRIPTS).length).toBeGreaterThanOrEqual(5);
  });

  it('every script named exists, takes its variable, and defaults to the manifest pin', () => {
    for (const component of CORE_COMPONENTS) {
      const how = CORE_UPDATE[component];
      if (typeof how === 'string') continue;
      const path = Object.keys(SCRIPTS).find((p) => p.endsWith(`/${how.script}`));
      expect(path, `${component}: ${how.script}`).toBeDefined();
      const src = SCRIPTS[path!]!;
      if (how.env) expect(src, `${component}: ${how.env.name}`).toContain(`${how.env.name}=`);
      expect(src, `${component}: pin ${PIN(component)}`).toContain(PIN(component));
    }
  });
});
