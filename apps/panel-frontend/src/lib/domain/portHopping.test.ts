import { describe, expect, it } from 'vitest';
import { portInHopRange } from '@/lib/domain/portHopping';

describe('portInHopRange: UDP-порт внутри hopping hysteria ноды', () => {
  const hy = { engines: ['hysteria' as const, 'xray' as const] };

  it('udp внутри 20000-50000 на ноде с hysteria: да, границы включительно', () => {
    expect(portInHopRange('udp', 30000, hy)).toBe(true);
    expect(portInHopRange('udp', 20000, hy)).toBe(true);
    expect(portInHopRange('udp', 50000, hy)).toBe(true);
  });

  it('вне диапазона, tcp, нет порта: нет', () => {
    expect(portInHopRange('udp', 19999, hy)).toBe(false);
    expect(portInHopRange('udp', 50001, hy)).toBe(false);
    expect(portInHopRange('tcp', 30000, hy)).toBe(false);
    expect(portInHopRange('udp', '', hy)).toBe(false);
  });

  it('hysteria на ноде нет или нода не сообщала: молчит', () => {
    expect(portInHopRange('udp', 30000, { engines: ['xray'] })).toBe(false);
    expect(portInHopRange('udp', 30000, {})).toBe(false);
  });

  it('свой диапазон ноды, когда он есть', () => {
    expect(portInHopRange('udp', 30000, hy, { from: 40000, to: 45000 })).toBe(false);
    expect(portInHopRange('udp', 41000, hy, { from: 40000, to: 45000 })).toBe(true);
  });
});
