import { describe, expect, it } from 'vitest';
import { buildOutlineJson } from './outline.js';
import type { SubscriptionEndpoint } from '../subscription.formats.js';

const ssEp: SubscriptionEndpoint = {
  protocol: 'shadowsocks',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 8388,
  method: '2022-blake3-aes-128-gcm',
  password: 'ss-pass',
  uri: 'ss://...',
};

const hyEp: SubscriptionEndpoint = {
  protocol: 'hysteria',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  password: 'hy',
  uri: 'hysteria2://...',
};

describe('buildOutlineJson (SIP008)', () => {
  it('emits SIP008 v1 with one server per shadowsocks endpoint', () => {
    const cfg = JSON.parse(buildOutlineJson([ssEp]));
    expect(cfg.version).toBe(1);
    expect(cfg.servers).toHaveLength(1);
    expect(cfg.servers[0]).toMatchObject({
      remarks: 'eu-1',
      server: 'n1.example.com',
      server_port: 8388,
      password: 'ss-pass',
      method: '2022-blake3-aes-128-gcm',
    });
    expect(cfg.servers[0].id).toBeTruthy();
  });

  it('skips non-shadowsocks endpoints', () => {
    const cfg = JSON.parse(buildOutlineJson([hyEp, ssEp]));
    expect(cfg.servers).toHaveLength(1);
    expect(cfg.servers[0].server).toBe('n1.example.com');
  });

  it('returns an empty servers array when there is no SS endpoint', () => {
    const cfg = JSON.parse(buildOutlineJson([hyEp]));
    expect(cfg.servers).toEqual([]);
  });

  it('uses hostId as the stable server id when present', () => {
    const cfg = JSON.parse(buildOutlineJson([{ ...ssEp, hostId: 'host-123' }]));
    expect(cfg.servers[0].id).toBe('host-123');
  });

  it('is valid JSON with a trailing newline', () => {
    const out = buildOutlineJson([ssEp]);
    expect(out.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
