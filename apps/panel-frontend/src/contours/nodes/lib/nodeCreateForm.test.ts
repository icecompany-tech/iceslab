import { describe, expect, it } from 'vitest';
import { CORE_COMPONENTS } from '@iceslab/shared';
import {
  createCoreVersions,
  enginesPayload,
  legacyEngines,
  makePrimary,
  nodeEnginesRefusal,
  primaryProtocols,
  protocolForPrimary,
  toggleEngine,
  wizardCoreComponents,
} from '@/contours/nodes/lib/nodeCreateForm';
import { enginesPatch } from '@/contours/nodes/lib/nodeEditForm';
import { intendedEnginesWords } from '@/lib/domain/engines';

describe('wizardCoreComponents: ядра выбранных движков первыми', () => {
  it('hysteria: hysteria сверху, остальные под «остальные ядра», caddy-naive не предлагается вовсе', () => {
    const { relevant, others } = wizardCoreComponents(['hysteria']);
    expect(relevant).toEqual(['hysteria']);
    expect(others).not.toContain('hysteria');
    expect([...relevant, ...others]).not.toContain('caddy-naive');
    expect(new Set([...relevant, ...others]).size).toBe(CORE_COMPONENTS.length - 1);
  });

  it('по всем выбранным движкам: AWG двумя компонентами, порядок движков сохраняется', () => {
    expect(wizardCoreComponents(['amneziawg']).relevant).toEqual(['amneziawg-module', 'amneziawg-tools']);
    expect(wizardCoreComponents(['xray', 'hysteria', 'singbox']).relevant).toEqual(['xray', 'hysteria', 'singbox']);
    expect(wizardCoreComponents(['singbox', 'amneziawg']).relevant).toEqual([
      'singbox',
      'amneziawg-module',
      'amneziawg-tools',
    ]);
  });

  it('старая форма: протокол и переключатель sing-box дают тот же список', () => {
    expect(legacyEngines('shadowsocks', false)).toEqual(['xray']);
    expect(legacyEngines('xray', true)).toEqual(['xray', 'singbox']);
    expect(legacyEngines('tuic', true)).toEqual(['singbox']);
  });
});

describe('движки ноды: чипы, основной, протокол под основным', () => {
  it('протоколы основного: xray это xray или shadowsocks, sing-box это tuic, anytls, shadowtls, прочие свои', () => {
    expect(primaryProtocols('xray')).toEqual(['xray', 'shadowsocks']);
    expect(primaryProtocols('singbox')).toEqual(['tuic', 'anytls', 'shadowtls']);
    expect(primaryProtocols('amneziawg')).toEqual(['amneziawg']);
    expect(primaryProtocols('mtproto')).toEqual(['mtproto']);
  });

  it('чип добавляет в конец и снимает; последний не снимается', () => {
    expect(toggleEngine(['xray'], 'hysteria')).toEqual(['xray', 'hysteria']);
    expect(toggleEngine(['xray', 'hysteria'], 'xray')).toEqual(['hysteria']);
    expect(toggleEngine(['xray'], 'xray')).toEqual(['xray']);
  });

  it('у стоящей ноды основное не снимается, остальные снимаются (core-lifecycle §8)', () => {
    expect(toggleEngine(['xray', 'hysteria'], 'xray', true)).toEqual(['xray', 'hysteria']);
    expect(toggleEngine(['xray', 'hysteria'], 'hysteria', true)).toEqual(['xray']);
  });

  it('основной переставляется вперёд, протокол следует за ним', () => {
    expect(makePrimary(['xray', 'hysteria', 'singbox'], 'singbox')).toEqual(['singbox', 'xray', 'hysteria']);
    expect(protocolForPrimary('shadowsocks', 'xray')).toBe('shadowsocks');
    expect(protocolForPrimary('shadowsocks', 'singbox')).toBe('tuic');
    expect(protocolForPrimary('xray', 'hysteria')).toBe('hysteria');
  });

  it('тело: новый сервер получает intendedEngines и protocol, старый прежние поля', () => {
    expect(enginesPayload(true, ['xray', 'singbox'], 'xray')).toEqual({
      intendedEngines: ['xray', 'singbox'],
      protocol: 'xray',
    });
    expect(enginesPayload(false, ['xray', 'singbox'], 'xray')).toEqual({ protocol: 'xray', singboxEngine: true });
    expect(enginesPayload(false, ['amneziawg', 'singbox'], 'amneziawg')).toEqual({
      protocol: 'amneziawg',
      singboxEngine: false,
    });
  });
});

describe('nodeEnginesRefusal: 400 INVALID_ENGINES по полю', () => {
  const res = (data: unknown, status = 400) => ({ response: { status, data } });

  it('поле из path и фраза сервера', () => {
    expect(
      nodeEnginesRefusal(res({ error: 'INVALID_ENGINES', message: 'a sing-box primary needs its protocol', path: ['protocol'] })),
    ).toEqual({ field: 'protocol', message: 'a sing-box primary needs its protocol' });
    expect(nodeEnginesRefusal(res({ error: 'INVALID_ENGINES', path: ['intendedEngines'] }))?.field).toBe('intendedEngines');
  });

  it('мусор и чужие ответы: null', () => {
    for (const e of [
      null,
      'x',
      new Error('x'),
      res({ error: 'INVALID_ENGINES', path: ['name'] }),
      res({ error: 'INVALID_ENGINES', path: 'protocol' }),
      res({ error: 'VALIDATION_ERROR', path: ['protocol'] }),
      res({ error: 'INVALID_ENGINES', path: ['protocol'] }, 409),
      res(null),
    ]) {
      expect(nodeEnginesRefusal(e)).toBeNull();
    }
  });
});

describe('enginesPatch: PUT по трём значениям', () => {
  it('не менялось или сервер поля не знает: ключа нет', () => {
    expect(enginesPatch(['xray', 'singbox'], ['xray', 'singbox'])).toBeUndefined();
    expect(enginesPatch(undefined, ['xray'])).toBeUndefined();
    expect(enginesPatch(['xray'], [])).toBeUndefined();
  });

  it('список заменяет список, и порядок тоже правка: первое основное', () => {
    expect(enginesPatch(['xray'], ['xray', 'hysteria'])).toEqual(['xray', 'hysteria']);
    expect(enginesPatch(['xray', 'singbox'], ['singbox', 'xray'])).toEqual(['singbox', 'xray']);
  });

  it('заголовок ноды: ядра через плюс, основное первым', () => {
    expect(intendedEnginesWords(['xray', 'hysteria', 'singbox'])).toBe('xray + hysteria + sing-box');
  });
});

describe('createCoreVersions: ключ только с выбором', () => {
  it('ничего не выбрано: ключа нет, сервер ставит пины', () => {
    expect(createCoreVersions(true, {})).toBeUndefined();
  });

  it('выбрано: ровно выбранные компоненты', () => {
    expect(createCoreVersions(true, { singbox: '1.13.14' })).toEqual({ singbox: '1.13.14' });
  });

  it('сервер старше поля: не шлём, даже если выбрано', () => {
    expect(createCoreVersions(false, { singbox: '1.13.14' })).toBeUndefined();
  });
});
