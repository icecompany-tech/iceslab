import { describe, expect, it } from 'vitest';
import { singboxXrayPatch, transportsFor } from '@/contours/profiles/lib/xrayTransports';

describe('transportsFor: mKCP не предлагается', () => {
  const offered = (stored: unknown, current: Parameters<typeof transportsFor>[1]) => transportsFor(stored, current).map((t) => t.value);

  it('новому профилю и профилю на другом транспорте его нет', () => {
    expect(offered(undefined, 'raw')).toEqual(['raw', 'ws', 'grpc', 'xhttp', 'httpupgrade']);
    expect(offered('xhttp', 'xhttp')).not.toContain('kcp');
  });

  it('профиль на mKCP видит его как есть, и когда в форме уже выбран другой', () => {
    expect(offered('kcp', 'kcp')).toContain('kcp');
    expect(offered('kcp', 'raw')).toContain('kcp');
  });

  it('чужой рецепт поставил mKCP: строка видна, форма не молчит', () => {
    expect(offered(undefined, 'kcp')).toContain('kcp');
  });
});

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
