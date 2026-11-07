import { describe, expect, it } from 'vitest';
import { slotConflictsOf, slotLabel, userScopeGapsOf } from '@/contours/nodes/lib/nodeAdapterFacts';

describe('slotLabel: слот словами', () => {
  const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;
  it('AmneziaWG: в engine поколение, говорится «AmneziaWG 3.1» и «AmneziaWG 1.x», не «на 3»', () => {
    expect(slotLabel('amneziawg', '3', t)).toBe('AmneziaWG 3.1');
    expect(slotLabel('amneziawg', '1', t)).toBe('AmneziaWG 1.x');
  });
  it('прочие: протокол на своём движке', () => {
    expect(slotLabel('shadowsocks', 'xray', t)).toBe('nodeEdit.slotPair {"protocol":"Shadowsocks","engine":"xray"}');
    expect(slotLabel('shadowsocks', 'singbox', t)).toBe('nodeEdit.slotPair {"protocol":"Shadowsocks","engine":"sing-box"}');
  });
});

describe('slotConflictsOf (A-195): несколько профилей на одном адаптере ноды', () => {
  it('нода обслуживает один, остальные названы', () => {
    expect(
      slotConflictsOf([
        {
          protocol: 'shadowsocks',
          engine: 'xray',
          bindings: [
            { bindingId: 'a', profileName: 'ss-low', port: 8388 },
            { bindingId: 'b', profileName: 'ss-high', port: 9388 },
          ],
          servedBindingId: 'b',
        },
      ]),
    ).toEqual([
      { protocol: 'shadowsocks', engine: 'xray', served: { profileName: 'ss-high', port: 9388 }, others: [{ profileName: 'ss-low', port: 8388 }] },
    ]);
  });
  it('поля нет (старый сервер): null, не «нет»; пустой массив: нет; мусор пропускается', () => {
    expect(slotConflictsOf(undefined)).toBeNull();
    expect(slotConflictsOf([])).toEqual([]);
    expect(slotConflictsOf([null, { protocol: 1 }])).toEqual([]);
  });
  it('слот это пара протокол и движок: shadowsocks на xray и на sing-box два конфликта; без движка не рисуется', () => {
    const two = (engine: unknown) => ({
      protocol: 'shadowsocks',
      engine,
      bindings: [
        { bindingId: `${String(engine)}-1`, profileName: 'a', port: 1 },
        { bindingId: `${String(engine)}-2`, profileName: 'b', port: 2 },
      ],
    });
    const out = slotConflictsOf([two('xray'), two('singbox'), two(undefined)])!;
    expect(out.map((c) => `${c.protocol}|${c.engine}`)).toEqual(['shadowsocks|xray', 'shadowsocks|singbox']);
  });
  it('меньше двух привязок после отсева мусора: не рисуется', () => {
    expect(
      slotConflictsOf([
        { protocol: 'mieru', engine: 'mieru', bindings: [{ bindingId: 'a', profileName: 'x', port: 1 }, { bindingId: 'b' }], servedBindingId: 'a' },
      ]),
    ).toEqual([]);
  });
});

describe('userScopeGapsOf (A-204): где ограничение сквада по юзеру на ноде не действует', () => {
  it('профиль, порт и почему', () => {
    expect(
      userScopeGapsOf([{ bindingId: 'x', profileId: 'p', profileName: 'mieru-2', protocol: 'mieru', port: 2999, gap: 'shared-users' }]),
    ).toEqual([{ profileName: 'mieru-2', port: 2999, gap: 'shared-users' }]);
  });
  it('поля нет: null; пусто: нет; незнакомый gap и мусор пропускаются', () => {
    expect(userScopeGapsOf(undefined)).toBeNull();
    expect(userScopeGapsOf([])).toEqual([]);
    expect(userScopeGapsOf([{ profileName: 'x', port: 1, gap: 'other' }, 3])).toEqual([]);
  });
});
