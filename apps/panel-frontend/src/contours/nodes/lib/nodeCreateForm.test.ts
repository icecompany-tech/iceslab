import { describe, expect, it } from 'vitest';
import { CORE_COMPONENTS } from '@iceslab/shared';
import {
  corePickable,
  createCoreVersions,
  engineListForLabel,
  enginesPayload,
  legacyEngines,
  nodeEnginesRefusal,
  sameEngines,
  toggleEngine,
  wizardCoreComponents,
} from '@/contours/nodes/lib/nodeCreateForm';
import { enginesPatch, nodeEnginesPut } from '@/contours/nodes/lib/nodeEditForm';
import { intendedEnginesWords, nodeIntentWords } from '@/lib/domain/engines';
import { protocolDerived } from '@/lib/domain/nodeFields';

describe('wizardCoreComponents: ядра выбранных движков первыми', () => {
  it('hysteria: hysteria сверху, остальные под «остальные ядра»; строк столько, сколько компонентов в манифесте', () => {
    const { relevant, others } = wizardCoreComponents(['hysteria']);
    expect(relevant).toEqual(['hysteria']);
    expect(others).not.toContain('hysteria');
    expect(new Set([...relevant, ...others]).size).toBe(CORE_COMPONENTS.length);
  });

  it('NaiveProxy: строка caddy-naive есть, выбора у неё нет (собирается из ветки)', () => {
    expect(wizardCoreComponents(['naive']).relevant).toEqual(['caddy-naive']);
    expect(corePickable('caddy-naive')).toBe(false);
    expect(corePickable('xray')).toBe(true);
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

describe('движки ноды: множество без основного (25.09)', () => {
  it('любой чип снимается, в том числе бывший первым; последний не снимается', () => {
    expect(toggleEngine(['xray'], 'hysteria')).toEqual(['xray', 'hysteria']);
    expect(toggleEngine(['xray', 'hysteria'], 'xray')).toEqual(['hysteria']);
    expect(toggleEngine(['xray', 'hysteria'], 'hysteria')).toEqual(['xray']);
    expect(toggleEngine(['xray'], 'xray')).toEqual(['xray']);
    expect(toggleEngine(['singbox'], 'singbox')).toEqual(['singbox']);
  });

  it('порядок не в счёт: те же ядра в другом порядке одно множество', () => {
    expect(sameEngines(['xray', 'singbox'], ['singbox', 'xray'])).toBe(true);
    expect(sameEngines(['xray'], ['xray', 'hysteria'])).toBe(false);
  });

  it('метка для сервера, что ещё сверяет первое ядро: нынешняя сохраняется, её ядро встаёт первым', () => {
    expect(engineListForLabel(['hysteria', 'xray'], 'shadowsocks')).toEqual({
      engines: ['xray', 'hysteria'],
      protocol: 'shadowsocks',
    });
    expect(engineListForLabel(['singbox', 'xray'], 'anytls')).toEqual({ engines: ['singbox', 'xray'], protocol: 'anytls' });
    // Ядро метки снято: метка первого ядра по таблице; у sing-box она обязательна.
    expect(engineListForLabel(['hysteria', 'singbox'], 'xray')).toEqual({
      engines: ['hysteria', 'singbox'],
      protocol: 'hysteria',
    });
    expect(engineListForLabel(['singbox'], 'xray')).toEqual({ engines: ['singbox'], protocol: 'tuic' });
  });

  it('тело создания: метка в паре, пока сервер её сверяет; без метки, когда выводит сам; старый сервер прежние поля', () => {
    expect(enginesPayload(true, false, ['hysteria', 'xray'], 'xray')).toEqual({
      intendedEngines: ['xray', 'hysteria'],
      protocol: 'xray',
    });
    const derived = enginesPayload(true, true, ['hysteria', 'xray'], 'xray');
    expect(derived).toEqual({ intendedEngines: ['hysteria', 'xray'] });
    expect('protocol' in derived).toBe(false);
    expect(enginesPayload(false, false, ['xray', 'singbox'], 'xray')).toEqual({ protocol: 'xray', singboxEngine: true });
    expect(enginesPayload(false, false, ['amneziawg', 'singbox'], 'amneziawg')).toEqual({
      protocol: 'amneziawg',
      singboxEngine: false,
    });
  });

  it('признак «сервер выводит метку сам» только по fields и только по названному имени', () => {
    expect(protocolDerived({ fields: ['intendedEngines'] })).toBe(false);
    expect(protocolDerived({ fields: ['protocolDerived'] }, 'protocolDerived')).toBe(true);
    expect(protocolDerived({ fields: ['intendedEngines'] }, 'protocolDerived')).toBe(false);
    expect(protocolDerived(undefined, 'protocolDerived')).toBe(false);
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

  it('список заменяет список; другой порядок тех же ядер не правка', () => {
    expect(enginesPatch(['xray'], ['xray', 'hysteria'])).toEqual(['xray', 'hysteria']);
    expect(enginesPatch(['xray', 'singbox'], ['singbox', 'xray'])).toBeUndefined();
  });

  it('заголовок ноды: ядра через плюс в одном порядке, как бы список ни хранился', () => {
    expect(intendedEnginesWords(['xray', 'hysteria', 'singbox'])).toBe('xray + hysteria + sing-box');
    expect(intendedEnginesWords(['singbox', 'hysteria', 'xray'])).toBe('xray + hysteria + sing-box');
  });

  it('строка без отчёта: ядра намерения вместо метки; у сервера старше поля null', () => {
    expect(nodeIntentWords({ intendedEngines: ['amneziawg', 'xray'] })).toBe('xray + amneziawg');
    expect(nodeIntentWords({})).toBeNull();
    expect(nodeIntentWords({ intendedEngines: [] })).toBeNull();
  });
});

describe('nodeEnginesPut: ядра и метка в PUT ноды', () => {
  it('сервер без поля: прежний protocol из селекта', () => {
    expect(nodeEnginesPut(false, false, undefined, [], 'shadowsocks')).toEqual({ protocol: 'shadowsocks' });
  });

  it('ядра не правились (и перестановка не правка): ни списка, ни метки', () => {
    expect(nodeEnginesPut(true, false, ['xray', 'hysteria'], ['hysteria', 'xray'], 'xray')).toEqual({});
  });

  it('правились: метка в паре, пока сервер её сверяет; только список, когда выводит сам', () => {
    expect(nodeEnginesPut(true, false, ['xray', 'hysteria'], ['hysteria'], 'xray')).toEqual({
      intendedEngines: ['hysteria'],
      protocol: 'hysteria',
    });
    const derived = nodeEnginesPut(true, true, ['xray', 'hysteria'], ['hysteria'], 'xray');
    expect(derived).toEqual({ intendedEngines: ['hysteria'] });
    expect('protocol' in derived).toBe(false);
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
