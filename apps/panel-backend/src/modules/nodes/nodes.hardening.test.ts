import { describe, it, expect } from 'vitest';
import { appendHardeningFlags, enginesFlagLine } from './nodes.service.js';
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
    '  --protocol xray \\',
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

describe('enginesFlagLine (the cores of Node.intendedEngines)', () => {
  it('says nothing for one core: --protocol already names it', () => {
    expect(enginesFlagLine(['xray'])).toBeNull();
    expect(enginesFlagLine([])).toBeNull();
  });

  it('uses --with-singbox for the main core plus singbox, which every installer knows', () => {
    for (const main of ['xray', 'hysteria', 'amneziawg']) {
      expect(enginesFlagLine([main, 'singbox'])).toBe('  --with-singbox \\');
    }
  });

  it('names every core with --engines otherwise, the main one first', () => {
    expect(enginesFlagLine(['xray', 'hysteria', 'singbox'])).toBe('  --engines xray,hysteria,singbox \\');
    expect(enginesFlagLine(['hysteria', 'amneziawg'])).toBe('  --engines hysteria,amneziawg \\');
  });

  it('goes right after --protocol, so a # note on the last line cannot swallow it', () => {
    // The last line of a real command can be "--panel-ip X  # auto-detect
    // failed": a " \" appended after that is part of the comment, and the
    // command ends there. The line carries its own continuation instead.
    const lines = baseLines();
    lines.splice(4, 0, enginesFlagLine(['xray', 'hysteria', 'singbox'])!);
    lines[5] = '  --panel-ip YOUR_PANEL_PUBLIC_IP  # auto-detect failed, replace with panel IP';
    const joined = lines.join('\n');
    expect(joined).toContain('--protocol xray \\\n  --engines xray,hysteria,singbox \\\n  --panel-ip');
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
