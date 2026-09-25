import { describe, it, expect } from 'vitest';
import type { EngineName } from '@iceslab/shared';
import { appendHardeningFlags, buildInstallCommand, enginesFlag } from './nodes.service.js';
import { HardeningSchema } from './nodes.schemas.js';

// The render functions build the install command as an array of lines and join
// with '\n'. appendHardeningFlags(lines, hardening) mutates that array in place,
// appending one --flag per enabled toggle. It is the SHARED contract between
// renderBootstrapCommand (service create-path) and renderRefreshBootstrapCommand
// (routes refresh-path), so the two stay byte-identical. These tests pin the
// flag mapping + the byte-identical-when-empty guarantee.

/** Mimic the static head of the install command both renderers start from. */
function baseLines(): string[] {
  return [
    'bash <(curl -fsSL https://example/install-iceslab-node.sh) \\',
    '  --panel-url https://panel.example.com \\',
    '  --bootstrap bs_token \\',
    '  --engines xray \\',
    '  --panel-ip 203.0.113.10',
  ];
}

describe('appendHardeningFlags (install-command generation)', () => {
  it('appends nothing for null/undefined hardening (byte-identical to today)', () => {
    const before = baseLines().join('\n');

    const a = baseLines();
    appendHardeningFlags(a, null);
    expect(a.join('\n')).toBe(before);

    const b = baseLines();
    appendHardeningFlags(b, undefined);
    expect(b.join('\n')).toBe(before);
  });

  it('appends nothing for an all-off / empty hardening blob', () => {
    const before = baseLines().join('\n');
    const lines = baseLines();
    appendHardeningFlags(lines, {});
    expect(lines.join('\n')).toBe(before);

    const lines2 = baseLines();
    appendHardeningFlags(lines2, {
      ufwLockdown: false,
      fail2ban: false,
      realisticFallback: false,
      sshAllowlist: [],
    });
    expect(lines2.join('\n')).toBe(before);
  });

  it('maps each toggle to its install-script flag', () => {
    const lines = baseLines();
    appendHardeningFlags(lines, {
      ufwLockdown: true,
      fail2ban: true,
      realisticFallback: true,
      sshAllowlist: ['203.0.113.4', '10.0.0.0/8'],
    });
    const out = lines.join('\n');
    expect(out).toContain('--harden-ufw');
    expect(out).toContain('--fail2ban');
    expect(out).toContain('--realistic-fallback');
    expect(out).toContain('--ssh-allowlist 203.0.113.4,10.0.0.0/8');
  });

  it('only appends flags for enabled toggles', () => {
    const lines = baseLines();
    appendHardeningFlags(lines, { fail2ban: true });
    const out = lines.join('\n');
    expect(out).toContain('--fail2ban');
    expect(out).not.toContain('--harden-ufw');
    expect(out).not.toContain('--realistic-fallback');
    expect(out).not.toContain('--ssh-allowlist');
  });

  it('adds a trailing line-continuation to the previous last line, none on its own last', () => {
    const lines = baseLines();
    // The previous last static line had no trailing backslash.
    expect(lines[lines.length - 1].endsWith('\\')).toBe(false);

    appendHardeningFlags(lines, { ufwLockdown: true, fail2ban: true });

    // The pre-existing last line now carries the continuation...
    expect(lines[4].endsWith(' \\')).toBe(true);
    // ...the first appended flag continues...
    expect(lines[5]).toBe('  --harden-ufw \\');
    // ...and the final appended flag has no trailing backslash (command ends).
    expect(lines[6]).toBe('  --fail2ban');
    expect(lines[lines.length - 1].endsWith('\\')).toBe(false);
  });

  it('produces identical output regardless of which renderer assembles the head', () => {
    // Both renderers share appendHardeningFlags, so the same input + same head
    // must yield byte-identical tails. Simulate both call sites here.
    const hardening = {
      ufwLockdown: true,
      sshAllowlist: ['198.51.100.1'],
    };
    const fromService = baseLines();
    const fromRoutes = baseLines();
    appendHardeningFlags(fromService, hardening);
    appendHardeningFlags(fromRoutes, hardening);
    expect(fromService.join('\n')).toBe(fromRoutes.join('\n'));
  });
});

describe('enginesFlag (the cores of Node.intendedEngines)', () => {
  it('names every core with --engines, one core too', () => {
    expect(enginesFlag(['xray'])).toBe('--engines xray');
    expect(enginesFlag(['hysteria', 'singbox'])).toBe('--engines hysteria,singbox');
    expect(enginesFlag(['xray', 'hysteria', 'singbox'])).toBe('--engines xray,hysteria,singbox');
  });

  it('is a set: the order it was ticked in says nothing, one set is one line', () => {
    expect(enginesFlag(['singbox', 'hysteria', 'xray'])).toBe('--engines xray,hysteria,singbox');
    expect(enginesFlag(['amneziawg', 'hysteria'])).toBe(enginesFlag(['hysteria', 'amneziawg']));
  });
});

describe('buildInstallCommand: no # inside the command, whatever the placeholders', () => {
  /**
   * The bug this closes. The placeholders used to carry their note on the same
   * line, "--panel-ip YOUR_PANEL_PUBLIC_IP  # auto-detect failed", and the next
   * flag was appended with a " \" that landed INSIDE that comment. Bash ended
   * the command there: every hardening flag after it was silently dropped, on
   * exactly the panel whose IP probe had failed.
   *
   * So: every combination of the two placeholders, hysteria or not, hardening
   * or not, one core or three. The notes may only be comment lines ABOVE the
   * command; inside it no line has a "#", and every line but the last ends in
   * " \".
   */
  const full = { ufwLockdown: true, fail2ban: true, realisticFallback: true, sshAllowlist: ['203.0.113.4'] };
  const cases: { panelIp: string | null; acmeEmail: string; hardening: typeof full | null; engines: EngineName[] }[] = [];
  for (const panelIp of [null, '198.51.100.7'])
    for (const acmeEmail of ['', 'ops@example.com'])
      for (const hardening of [null, full])
        for (const engines of [['xray'], ['hysteria'], ['singbox', 'hysteria', 'xray']] as EngineName[][])
          cases.push({ panelIp, acmeEmail, hardening, engines });

  it.each(cases)('%o', (c) => {
    const cmd = buildInstallCommand({
      panelUrl: 'https://panel.example.com',
      token: 'bs_token',
      nodeAddress: 'node.example.com:1337',
      ...c,
    });
    const lines = cmd.split('\n');
    const start = lines.findIndex((l) => l.startsWith('bash <('));
    expect(start, cmd).toBeGreaterThanOrEqual(0);
    for (const note of lines.slice(0, start)) expect(note, cmd).toMatch(/^# /);
    const body = lines.slice(start);
    for (const l of body) expect(l, cmd).not.toContain('#');
    for (const l of body.slice(0, -1)) expect(l, cmd).toMatch(/ \\$/);
    expect(body[body.length - 1], cmd).not.toMatch(/\\$/);
    // And what the bug used to lose is there.
    if (c.hardening) {
      expect(cmd).toContain('--harden-ufw');
      expect(cmd).toContain('--ssh-allowlist 203.0.113.4');
    }
    if (!c.panelIp) expect(cmd).toMatch(/^# panel IP auto-detect failed/m);
    if (c.engines.includes('hysteria') && !c.acmeEmail) expect(cmd).toMatch(/^# set ACME_DEFAULT_EMAIL/m);
  });

  it('names the cores right after the token, and no --protocol', () => {
    const cmd = buildInstallCommand({
      panelUrl: 'https://p',
      token: 't',
      engines: ['xray', 'hysteria', 'singbox'],
      panelIp: '198.51.100.7',
      acmeEmail: '',
    });
    expect(cmd).toContain('  --bootstrap t \\\n  --engines xray,hysteria,singbox \\\n  --panel-ip 198.51.100.7');
    expect(cmd).not.toContain('--protocol');
  });

  it('writes the hysteria flags when hysteria is in the set, wherever it stands', () => {
    const cmd = (engines: EngineName[]) =>
      buildInstallCommand({
        panelUrl: 'https://p',
        token: 't',
        nodeAddress: 'hy.example.com:1337',
        engines,
        panelIp: '198.51.100.7',
        acmeEmail: 'ops@example.com',
      });
    for (const engines of [['hysteria'], ['xray', 'hysteria'], ['singbox', 'hysteria']] as EngineName[][]) {
      expect(cmd(engines)).toContain('--hysteria-domain hy.example.com \\\n  --hysteria-email ops@example.com');
    }
    expect(cmd(['xray', 'singbox'])).not.toContain('--hysteria-');
  });
});
describe('HardeningSchema (validation contract)', () => {
  it('accepts a valid blob', () => {
    const parsed = HardeningSchema.parse({
      ufwLockdown: true,
      fail2ban: false,
      realisticFallback: true,
      sshAllowlist: ['203.0.113.4', '10.0.0.0/8'],
    });
    expect(parsed).toMatchObject({ ufwLockdown: true, realisticFallback: true });
  });

  it('accepts null / undefined (no hardening)', () => {
    expect(HardeningSchema.parse(null)).toBeNull();
    expect(HardeningSchema.parse(undefined)).toBeUndefined();
  });

  it('rejects unknown keys (typo fails loud, not a silent no-op)', () => {
    expect(() =>
      HardeningSchema.parse({ ufwLockown: true } as unknown),
    ).toThrow();
  });

  it('rejects a malformed allowlist entry', () => {
    expect(() =>
      HardeningSchema.parse({ sshAllowlist: ['not an ip!!'] }),
    ).toThrow();
  });

  it('rejects an over-long allowlist (max 16)', () => {
    const many = Array.from({ length: 17 }, (_, i) => `10.0.0.${i}`);
    expect(() => HardeningSchema.parse({ sshAllowlist: many })).toThrow();
  });
});
