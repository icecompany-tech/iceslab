import { describe, expect, it } from 'vitest';
import { nodePortClaims } from '@/contours/hosts/lib/portClaims';

const hosts = [
  { id: 'h-vless', bindingId: 'b-vless', remark: 'vless-ru-01' },
  { id: 'h-awg', bindingId: 'b-awg', remark: 'awg-ru-01' },
  { id: 'h-old', bindingId: 'b-old', remark: 'old-ru-02' },
];
const vless = { id: 'b-vless', nodeId: 'ru-01', port: 443, transport: 'tcp' as const };
const awg = { id: 'b-awg', nodeId: 'ru-01', port: 443, transport: 'udp' as const };

describe('nodePortClaims: порт занят парой (порт, транспорт), E40', () => {
  it('vless 443/tcp не закрывает hy2 443/udp', () => {
    expect(nodePortClaims([vless], hosts, 443, 'udp', undefined).size).toBe(0);
  });

  it('vless 443/tcp закрывает второй vless 443/tcp, с транспортом в подписи', () => {
    expect(nodePortClaims([vless], hosts, 443, 'tcp', undefined).get('ru-01')).toEqual({
      host: 'vless-ru-01',
      label: '443/tcp',
    });
  });

  it('awg 443/udp закрывает hy2 443/udp', () => {
    expect(nodePortClaims([awg], hosts, 443, 'udp', undefined).get('ru-01')).toEqual({ host: 'awg-ru-01', label: '443/udp' });
  });

  it('сервер старше поля (нет transport): закрывает по номеру, как раньше, подпись без транспорта', () => {
    const old = { id: 'b-old', nodeId: 'ru-02', port: 443 };
    expect(nodePortClaims([old], hosts, 443, 'udp', undefined).get('ru-02')).toEqual({ host: 'old-ru-02', label: '443' });
  });

  it('свой же хост порт не занимает; другой номер и пустой порт не занимают', () => {
    expect(nodePortClaims([vless], hosts, 443, 'tcp', 'h-vless').size).toBe(0);
    expect(nodePortClaims([vless], hosts, 8443, 'tcp', undefined).size).toBe(0);
    expect(nodePortClaims([vless], hosts, '', 'tcp', undefined).size).toBe(0);
  });
});
