import { describe, it, expect } from 'vitest';
import {
  CLIENTS,
  CLIENT_RULES,
  FORMAT_NAMES,
  type ClientDef,
  type ClientId,
} from '@iceslab/shared';
import { compileRule } from '../modules/srr/srr.service.js';
import { APPS } from '../modules/subscription/subscription.page-apps.js';

/**
 * The client catalog against the strings the apps really send.
 *
 * Every User-Agent sample in the catalog goes through CLIENT_RULES the way a
 * request goes through the seeded rules (priority ASC, first match, the same
 * compiler as srr.service.ts) and has to come out with its client's format.
 * That is the test the old seeds never had: `clash-verge/...` fell through a
 * case-sensitive `Clash` to plain, and Loon as `Decar` did the same.
 */

const ordered = [...CLIENT_RULES].sort((a, b) => a.priority - b.priority);
const firstMatch = (ua: string) => ordered.find((r) => compileRule(r.pattern).test(ua));
const entries = Object.entries(CLIENTS) as [ClientId, ClientDef][];

describe('every User-Agent sample lands on its client format', () => {
  const samples = entries.flatMap(([id, c]) => c.uaSamples.map((s) => [id, c, s.ua] as const));

  it('has samples to check', () => {
    expect(samples.length).toBeGreaterThan(15);
  });

  it.each(samples)('%s: %s', (id, client, ua) => {
    const rule = firstMatch(ua);
    expect(rule, `${ua} matched no rule`).toBeDefined();
    expect(rule!.format, `${ua} went to rule ${rule!.name}`).toBe(client.format);
    expect(rule!.clients, `rule ${rule!.name} does not name ${id}`).toContain(id);
  });
});

describe('the catalog keeps its own rules', () => {
  it('every sample names its source, and a client without one says why', () => {
    for (const [id, c] of entries) {
      for (const s of c.uaSamples) expect(s.source, `${id}: ${s.ua}`).toBeTruthy();
    }
  });

  it('rules name real clients, real formats, and end in the catch-all', () => {
    const names = new Set<string>();
    for (const r of CLIENT_RULES) {
      expect(names.has(r.name), `duplicate rule ${r.name}`).toBe(false);
      names.add(r.name);
      expect(FORMAT_NAMES as readonly string[]).toContain(r.format);
      for (const id of r.clients) expect(CLIENTS, `${r.name} -> ${id}`).toHaveProperty(id);
      expect(() => compileRule(r.pattern)).not.toThrow();
    }
    expect(ordered.at(-1)).toMatchObject({ name: 'Default', pattern: '.*', format: 'plain' });
  });

  it('carries the fixes the recon asked for', () => {
    const rule = (name: string) => CLIENT_RULES.find((r) => r.name === name);
    expect(rule('Clash')?.pattern).toBe('(?i)clash|mihomo');
    expect(rule('Stash')).toMatchObject({ pattern: '(?i)stash', format: 'clash' });
    expect(rule('Loon')?.pattern).toBe('(?i)loon|decar');
    expect(rule('NekoBox/NekoRay')?.format).toBe('clash');
  });
});

describe('the subscription page reads the catalog', () => {
  it('names every app the way the catalog does', () => {
    const catalogNames = new Set(entries.map(([, c]) => c.name));
    for (const app of APPS) expect(catalogNames, app.name).toContain(app.name);
  });
});
