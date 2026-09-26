import { describe, expect, it } from 'vitest';
import { userProtocols, withProtocols } from '@/contours/users/lib/subscriptionProtocols';

describe('userProtocols: протоколы из эндпоинтов пользователя', () => {
  it('без повторов, в порядке панели; незнакомое имя не попадает', () => {
    expect(
      userProtocols([
        { protocol: 'amneziawg' },
        { protocol: 'xray' },
        { protocol: 'hysteria' },
        { protocol: 'xray' },
        { protocol: 'vless' },
      ]),
    ).toEqual(['hysteria', 'xray', 'amneziawg']);
  });

  it('эндпоинтов нет или не пришли: пусто', () => {
    expect(userProtocols([])).toEqual([]);
    expect(userProtocols(undefined)).toEqual([]);
  });
});

describe('withProtocols: как у сервера', () => {
  const sub = 'https://panel.example.com/sub/abc';

  it('один протокол: параметр первым', () => {
    expect(withProtocols(sub, ['hysteria'])).toBe(`${sub}?protocols=hysteria`);
  });

  it('пустой список: без параметра; старый параметр снимается', () => {
    expect(withProtocols(sub, [])).toBe(sub);
    expect(withProtocols(`${sub}?protocols=xray`, [])).toBe(sub);
  });

  it('прочие параметры на местах, protocols первым, фрагмент в конце', () => {
    expect(withProtocols(`${sub}?format=clash&protocols=xray#x`, ['amneziawg'])).toBe(
      `${sub}?protocols=amneziawg&format=clash#x`,
    );
  });
});
