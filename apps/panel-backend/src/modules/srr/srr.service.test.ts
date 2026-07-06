import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { invalidateSrrCache, matchFormatForUserAgent } from './srr.service.js';

interface RuleSeed {
  name: string;
  uaPattern: string;
  format: string;
  priority?: number;
  enabled?: boolean;
}

async function seed(rules: RuleSeed[]): Promise<void> {
  for (const r of rules) {
    await prisma.subscriptionResponseRule.create({
      data: {
        name: r.name,
        uaPattern: r.uaPattern,
        format: r.format,
        priority: r.priority ?? 100,
        enabled: r.enabled ?? true,
      },
    });
  }
}

beforeEach(async () => {
  await cleanDatabase();
  invalidateSrrCache(); // the service caches compiled rules; reset between tests
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('matchFormatForUserAgent', () => {
  it('returns null when UA is empty / null', async () => {
    expect(await matchFormatForUserAgent(null)).toBeNull();
    expect(await matchFormatForUserAgent('')).toBeNull();
  });

  it('returns null when no rules exist', async () => {
    expect(await matchFormatForUserAgent('Hiddify/1.0')).toBeNull();
  });

  it('returns the format of the first matching rule by priority ASC', async () => {
    await seed([
      { name: 'a', uaPattern: 'Hiddify',  format: 'singbox', priority: 30 },
      { name: 'b', uaPattern: '.*',        format: 'plain',   priority: 999 },
      { name: 'c', uaPattern: 'Hiddify',  format: 'clash',   priority: 10 },
    ]);
    expect(await matchFormatForUserAgent('Hiddify/2.0')).toBe('clash');
  });

  it('falls through when first rules do not match', async () => {
    await seed([
      { name: 'a', uaPattern: 'NekoBox',  format: 'singbox', priority: 10 },
      { name: 'b', uaPattern: 'v2rayN',   format: 'xrayjson', priority: 20 },
      { name: 'c', uaPattern: '.*',        format: 'plain',   priority: 999 },
    ]);
    expect(await matchFormatForUserAgent('Mozilla/5.0 random')).toBe('plain');
  });

  it('skips disabled rules', async () => {
    await seed([
      { name: 'a', uaPattern: 'Hiddify', format: 'clash', priority: 10, enabled: false },
      { name: 'b', uaPattern: 'Hiddify', format: 'singbox', priority: 20 },
    ]);
    expect(await matchFormatForUserAgent('Hiddify/2.0')).toBe('singbox');
  });

  it('skips rules with invalid regex without crashing', async () => {
    await seed([
      { name: 'bad', uaPattern: '[invalid(', format: 'clash', priority: 10 },
      { name: 'ok',  uaPattern: 'Hiddify',    format: 'singbox', priority: 20 },
    ]);
    expect(await matchFormatForUserAgent('Hiddify/2.0')).toBe('singbox');
  });

  it('truncates very long UAs before matching (ReDoS defense)', async () => {
    await seed([
      { name: 'tail', uaPattern: 'TARGET$', format: 'clash', priority: 10 },
    ]);
    // 1000 chars of padding then TARGET, beyond the 256 cap so won't match.
    const padded = 'A'.repeat(1000) + 'TARGET';
    expect(await matchFormatForUserAgent(padded)).toBeNull();
    // But TARGET within the first 256 chars is matched.
    expect(await matchFormatForUserAgent('TARGET')).toBe('clash');
  });

  it('supports case-insensitive patterns via inline (?i)', async () => {
    await seed([
      { name: 'wg', uaPattern: '(?i)wireguard', format: 'wgconf', priority: 10 },
    ]);
    expect(await matchFormatForUserAgent('WireGuard/Android 1.2')).toBe('wgconf');
    expect(await matchFormatForUserAgent('wireguard-cli')).toBe('wgconf');
  });
});
