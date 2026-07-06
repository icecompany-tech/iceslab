import { describe, it, expect } from 'vitest';
import { escapeMarkdown, redactIp } from './telegram-notify.js';

describe('escapeMarkdown', () => {
  it('escapes the legacy Markdown metacharacters', () => {
    expect(escapeMarkdown('*bold*')).toBe('\\*bold\\*');
    expect(escapeMarkdown('_italic_')).toBe('\\_italic\\_');
    expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
    expect(escapeMarkdown('[link](url)')).toBe('\\[link\\](url)');
  });

  it('passes plain text unchanged', () => {
    expect(escapeMarkdown('Hello world 123')).toBe('Hello world 123');
    expect(escapeMarkdown('user@host:port')).toBe('user@host:port');
  });

  it('handles mixed content', () => {
    expect(escapeMarkdown('admin_user `cat /etc/passwd`')).toBe(
      'admin\\_user \\`cat /etc/passwd\\`',
    );
  });

  it('escapes brackets that could forge inline links', () => {
    // Adversary's username = `[click here](https://evil.example)`, without
    // escaping this would render as a clickable link in the Telegram alert
    // and could phish whoever sees the alert. After escape it's literal.
    const adversary = '[click here](https://evil.example)';
    const out = escapeMarkdown(adversary);
    expect(out).toContain('\\[');
    expect(out).toContain('\\]');
  });

  it('does NOT escape backslashes (one-pass)', () => {
    // We deliberately don't escape `\` itself, callers should never wrap
    // twice, but if they do, backslashes pass through unchanged so the
    // already-escaped meta chars stay escaped.
    const once = escapeMarkdown('*x*');
    expect(once).toBe('\\*x\\*');
    // Re-running escapes only the metacharacters again, leaving the
    // existing backslashes alone. Net effect: each `*` ends up with two
    // backslashes in front of it.
    expect(escapeMarkdown(once)).toBe('\\\\*x\\\\*');
  });
});

describe('redactIp', () => {
  it('coarsens plain IPv4 to /24', () => {
    expect(redactIp('1.2.3.4')).toBe('1.2.3.0/24');
    expect(redactIp('192.168.0.42')).toBe('192.168.0.0/24');
    expect(redactIp('203.0.113.1')).toBe('203.0.113.0/24');
  });

  it('coarsens plain IPv6 to /48', () => {
    expect(redactIp('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(redactIp('2606:4700:4700::1111')).toBe('2606:4700:4700::/48');
  });

  it('strips port from IPv4:port', () => {
    expect(redactIp('1.2.3.4:5678')).toBe('1.2.3.0/24');
    expect(redactIp('203.0.113.1:443')).toBe('203.0.113.0/24');
  });

  it('strips [v6]:port bracket form', () => {
    expect(redactIp('[2001:db8::1]:443')).toBe('2001:db8:0::/48');
  });

  it('unwraps IPv4-mapped IPv6 into v4 redaction', () => {
    // Critical regression: ::ffff:1.2.3.4 used to leak the full IP because
    // it contains both '.' and ':' and matched neither v4 nor pure-v6 branch.
    expect(redactIp('::ffff:1.2.3.4')).toBe('1.2.3.0/24');
    expect(redactIp('::FFFF:10.0.0.1')).toBe('10.0.0.0/24');
  });

  it('strips IPv6 zone id', () => {
    expect(redactIp('fe80::1%eth0')).toBe('fe80:0:0::/48');
  });

  it('falls back to [redacted] for non-IP garbage', () => {
    expect(redactIp('not an ip')).toBe('[redacted]');
    expect(redactIp('')).toBe('[redacted]');
    // Empty parts: was leaking unchanged in the old impl.
    expect(redactIp('256.256.256.256')).toBe('[redacted]');
  });

  it('handles edge cases without throwing', () => {
    // These must not crash; output isn't strictly specified but must be string.
    expect(typeof redactIp('::1')).toBe('string');
    expect(typeof redactIp('::')).toBe('string');
    expect(typeof redactIp('::ffff:0:0')).toBe('string');
  });
});
