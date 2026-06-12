import { describe, expect, it } from 'vitest';
import { parseCommand, formatStatusMessage, formatUserMessage } from './telegram-bot.js';

describe('parseCommand', () => {
  it('parses a bare command', () => {
    expect(parseCommand('/status')).toEqual({ cmd: 'status', args: [] });
  });
  it('parses a command with args', () => {
    expect(parseCommand('/user alice')).toEqual({ cmd: 'user', args: ['alice'] });
  });
  it('strips a trailing @botname (group mentions) and lowercases', () => {
    expect(parseCommand('/Status@MyBot')).toEqual({ cmd: 'status', args: [] });
  });
  it('tolerates extra whitespace', () => {
    expect(parseCommand('  /user   bob  ')).toEqual({ cmd: 'user', args: ['bob'] });
  });
  it('returns null for non-commands', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});

describe('formatStatusMessage', () => {
  it('renders users / nodes / traffic', () => {
    const msg = formatStatusMessage({
      users: { total: 42, onlineNow: 7 },
      system: { onlineNodeCount: 3, totalNodeCount: 4 },
      traffic: { todayBytes: 5 * 1024 * 1024 * 1024 },
    });
    expect(msg).toContain('users: 42 (7 online)');
    expect(msg).toContain('nodes: 3/4 online');
    expect(msg).toContain('traffic today: 5.0 GiB');
  });
});

describe('formatUserMessage', () => {
  it('renders a limited user with expiry', () => {
    const msg = formatUserMessage({
      username: 'alice',
      status: 'active',
      usedBytes: 1024 * 1024 * 1024,
      limitBytes: 10 * 1024 * 1024 * 1024,
      expireAt: new Date('2026-09-01T00:00:00Z'),
      onlineAt: new Date('2026-06-12T10:30:00Z'),
    });
    expect(msg).toContain('*alice*');
    expect(msg).toContain('status: active');
    expect(msg).toContain('traffic: 1.0 GiB / 10 GiB');
    expect(msg).toContain('expires: 2026-09-01');
    expect(msg).toContain('last online: 2026-06-12 10:30');
  });

  it('shows infinity for no limit and never for no expiry/online', () => {
    const msg = formatUserMessage({
      username: 'bob',
      status: 'active',
      usedBytes: 0,
      limitBytes: null,
      expireAt: null,
      onlineAt: null,
    });
    expect(msg).toContain('traffic: 0 B / ∞');
    expect(msg).toContain('expires: never');
    expect(msg).toContain('last online: never');
  });

  it('escapes markdown metacharacters in the username', () => {
    const msg = formatUserMessage({
      username: 'a_b*c',
      status: 'active',
      usedBytes: 0,
      limitBytes: null,
      expireAt: null,
      onlineAt: null,
    });
    expect(msg).toContain('a\\_b\\*c');
  });
});
