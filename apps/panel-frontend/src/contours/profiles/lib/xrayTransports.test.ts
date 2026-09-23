import { describe, expect, it } from 'vitest';
import { singboxXrayPatch } from '@/contours/profiles/lib/xrayTransports';

const v = (over: Partial<Parameters<typeof singboxXrayPatch>[0]>) => ({
  protocol: 'xray',
  engine: 'singbox' as const,
  xrayNetwork: 'raw',
  xraySecurity: 'reality',
  xrayRealityMode: 'steal-others',
  ...over,
});

describe('singboxXrayPatch: xray на sing-box только REALITY steal-others по raw', () => {
  it('уже подходит: править нечего', () => {
    expect(singboxXrayPatch(v({}))).toEqual({});
  });

  it('пришли с плитки xray с xhttp, TLS и self-steal: всё возвращается к допустимому', () => {
    expect(singboxXrayPatch(v({ xrayNetwork: 'xhttp', xraySecurity: 'tls', xrayRealityMode: 'self-steal' }))).toEqual({
      xrayNetwork: 'raw',
      xraySecurity: 'reality',
      xrayRealityMode: 'steal-others',
    });
  });

  it('на ядре xray и у других протоколов не трогается ничего', () => {
    expect(singboxXrayPatch(v({ engine: 'native', xrayNetwork: 'xhttp' }))).toEqual({});
    expect(singboxXrayPatch(v({ protocol: 'hysteria', xrayNetwork: 'xhttp' }))).toEqual({});
  });
});
