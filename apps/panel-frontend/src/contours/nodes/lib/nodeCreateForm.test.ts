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
import { enginesPatch, formProtocolOf, nodeEnginesPut } from '@/contours/nodes/lib/nodeEditForm';
import { intendedEnginesWords, nodeIntentWords } from '@/lib/domain/engines';

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

  it('по всем выбранным движкам: AWG двумя компонентами, строки в порядке манифеста, не щелчков', () => {
    expect(wizardCoreComponents(['amneziawg']).relevant).toEqual(['amneziawg-module', 'amneziawg-tools']);
    expect(wizardCoreComponents(['xray', 'hysteria', 'singbox']).relevant).toEqual(['xray', 'singbox', 'hysteria']);
    // Стенд 25.09: отмечены MTProto, Hysteria 2, Xray, строки всё равно xray первым.
    expect(wizardCoreComponents(['mtproto', 'hysteria', 'xray']).relevant).toEqual(['xray', 'hysteria', 'mtg']);
    expect(wizardCoreComponents(['amneziawg', 'singbox']).relevant).toEqual([
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
  it('любой чип снимается, в том числе последний: нода без ядер допустима', () => {
    expect(toggleEngine(['xray'], 'hysteria')).toEqual(['xray', 'hysteria']);
    expect(toggleEngine(['xray', 'hysteria'], 'xray')).toEqual(['hysteria']);
    expect(toggleEngine(['xray', 'hysteria'], 'hysteria')).toEqual(['xray']);
    expect(toggleEngine(['xray'], 'xray')).toEqual([]);
    expect(toggleEngine([], 'singbox')).toEqual(['singbox']);
  });

  it('нода без ядер: пустой список уходит как есть, версий выбирать не из чего', () => {
    expect(enginesPayload(true, [], 'xray')).toEqual({ intendedEngines: [], protocol: 'xray' });
    expect(wizardCoreComponents([])).toEqual({ relevant: [], others: [...CORE_COMPONENTS] });
    expect(nodeEnginesPut(true, ['xray'], [], 'xray')).toEqual({ intendedEngines: [], protocol: 'xray' });
    expect(formProtocolOf('none')).toBe('xray');
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

  it('тело создания: список и метка в паре; старый сервер прежние поля', () => {
    expect(enginesPayload(true, ['hysteria', 'xray'], 'xray')).toEqual({
      intendedEngines: ['xray', 'hysteria'],
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
    ).toEqual({ code: 'INVALID_ENGINES', field: 'protocol', message: 'a sing-box primary needs its protocol' });
    expect(nodeEnginesRefusal(res({ error: 'INVALID_ENGINES', path: ['intendedEngines'] }))?.field).toBe('intendedEngines');
  });

  it('LAST_CORE (93ad747): последнее ядро, по списку или по старому переключателю sing-box', () => {
    expect(
      nodeEnginesRefusal(res({ error: 'LAST_CORE', message: 'a node keeps at least one core', path: ['intendedEngines'] })),
    ).toEqual({ code: 'LAST_CORE', field: 'intendedEngines', message: 'a node keeps at least one core' });
    expect(nodeEnginesRefusal(res({ error: 'LAST_CORE', path: ['singboxEngine'] }))).toEqual({
      code: 'LAST_CORE',
      field: 'singboxEngine',
      message: '',
    });
    expect(nodeEnginesRefusal(res({ error: 'LAST_CORE', path: ['intendedEngines'] }, 409))).toBeNull();
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
    expect(enginesPatch([], [])).toBeUndefined();
  });

  it('снять все ядра это правка: пустой список уходит', () => {
    expect(enginesPatch(['xray'], [])).toEqual([]);
  });

  it('список заменяет список; другой порядок тех же ядер не правка', () => {
    expect(enginesPatch(['xray'], ['xray', 'hysteria'])).toEqual(['xray', 'hysteria']);
    expect(enginesPatch(['xray', 'singbox'], ['singbox', 'xray'])).toBeUndefined();
  });

  it('заголовок ноды: ядра через плюс в одном порядке, как бы список ни хранился', () => {
    expect(intendedEnginesWords(['xray', 'hysteria', 'singbox'])).toBe('xray + hysteria + sing-box');
    expect(intendedEnginesWords(['singbox', 'hysteria', 'xray'])).toBe('xray + hysteria + sing-box');
  });

  it('строка без отчёта: ядра намерения вместо метки; пустой набор «без ядер»; у сервера старше поля null', () => {
    const t = (k: string) => k;
    expect(nodeIntentWords({ intendedEngines: ['amneziawg', 'xray'] }, t)).toBe('xray + amneziawg');
    expect(nodeIntentWords({ intendedEngines: [] }, t)).toBe('engine.noCores');
    expect(nodeIntentWords({}, t)).toBeNull();
  });
});

describe('nodeEnginesPut: ядра и метка в PUT ноды', () => {
  it('сервер без поля: прежний protocol из селекта', () => {
    expect(nodeEnginesPut(false, undefined, [], 'shadowsocks')).toEqual({ protocol: 'shadowsocks' });
  });

  it('ядра не правились (и перестановка не правка): ни списка, ни метки', () => {
    expect(nodeEnginesPut(true, ['xray', 'hysteria'], ['hysteria', 'xray'], 'xray')).toEqual({});
  });

  it('метка singbox (нода только с sing-box) в форме читается как tuic; прочие как есть', () => {
    expect(formProtocolOf('singbox')).toBe('tuic');
    expect(formProtocolOf('hysteria')).toBe('hysteria');
    expect(formProtocolOf(undefined)).toBe('xray');
    expect(nodeEnginesPut(true, ['singbox', 'xray'], ['singbox'], formProtocolOf('xray'))).toEqual({
      intendedEngines: ['singbox'],
      protocol: 'tuic',
    });
  });

  it('правились: список и метка в паре', () => {
    expect(nodeEnginesPut(true, ['xray', 'hysteria'], ['hysteria'], 'xray')).toEqual({
      intendedEngines: ['hysteria'],
      protocol: 'hysteria',
    });
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
