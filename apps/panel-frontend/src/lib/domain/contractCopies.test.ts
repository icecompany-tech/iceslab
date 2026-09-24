import { describe, expect, it } from 'vitest';
import {
  CORE_COMPONENTS,
  CORE_ENV_PREFIX,
  CORE_NODE_DIR,
  componentsOfEngine,
  coreEnvPair,
  coreInstallCommand,
  ENGINE_BOOTSTRAP,
  judgeCoreVersion,
  DEFAULT_LINK_UNDERLAY,
  LINK_CELLS,
  LINK_CONGESTIONS,
  LINK_UNDERLAYS,
  REALITY_RECORD_LIMIT,
  REALITY_TARGET_SUGGESTIONS,
  TEMPLATE_TYPES,
  XRAY_PLAIN_SUBPROTOCOLS,
  XRAY_SUBPROTOCOLS,
} from '@iceslab/shared';

/**
 * Перечисления контракта объявляются в контракте, и больше нигде.
 *
 * Шестая копия за два дня нашлась именно так: `lib/domain/engines.ts` объявлял
 * свой `LINK_CELLS` из двух ячеек, ИМЯ совпадало с контрактным из четырёх, и
 * половина ячеек просто не доезжала до селектора ноги позиции. Ни сборка, ни
 * линт этого не видят: тень с тем же именем это законный код, а СОСТАВ
 * перечисления TypeScript не проверяет по построению.
 *
 * Поэтому проверка не про значения, а про ОБЪЯВЛЕНИЕ: во фронте этих имён
 * заводить нельзя, их можно только импортировать. Реэкспорт (`export { X }`)
 * объявлением не считается: он ровно про то, чтобы копии не было.
 *
 * Список имён ниже растёт вместе с контрактом. Сегодня в нём те, которыми уже
 * успели разойтись.
 */
const GUARDED = [
  'LINK_CELLS',
  'LINK_CONGESTIONS',
  'DEFAULT_LINK_CONGESTION',
  // На чём едет нога (фаза 8): direct | awg, дефолт из контракта.
  'LINK_UNDERLAYS',
  'DEFAULT_LINK_UNDERLAY',
  'TEMPLATE_TYPES',
  'FORMAT_NAMES',
  'XRAY_SUBPROTOCOLS',
  'XRAY_PLAIN_SUBPROTOCOLS',
  // Манифест версий ядер: состав компонентов и единственный судья версии.
  // Своё сравнение версий рядом с ним это второй судья, который разойдётся.
  'CORE_COMPONENTS',
  'CORE_VERSIONS',
  'judgeCoreVersion',
  'compareCoreVersions',
  // Имена переменных бутстрапов: одна таблица на установщик, агент и экран.
  'CORE_ENV_PREFIX',
  'coreEnvPair',
  // Какое ядро что сообщает и как его ставят: та же строка, что сервер кладёт
  // в howToInstall отказа CORE_NOT_ON_NODE (dd7a8cd). Своя копия во фронте уже
  // была (componentsOfEngine в coreVersions.ts, BOOTSTRAP и NODE_DIR в
  // «Ядрах», причём последняя ставила без пары версий).
  'componentsOfEngine',
  'CORE_NODE_DIR',
  'ENGINE_BOOTSTRAP',
  'coreInstallCommand',
  // Предел записи хендшейка REALITY и цели, замеренные на проход: строка
  // пробы dest печатает число, отказ сервера называет цели (46f634c). Копия
  // 8192 во фронте жила до 46f634c.
  'REALITY_RECORD_LIMIT',
  'REALITY_TARGET_SUGGESTIONS',
];

const FILES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SELF = '/src/lib/domain/contractCopies.test.ts';

describe('копии перечислений контракта', () => {
  it('1. ни одно охраняемое имя не объявляется во фронте', () => {
    const guilty: string[] = [];
    for (const [path, code] of Object.entries(FILES)) {
      if (path === SELF) continue;
      for (const name of GUARDED) {
        // `const X =`, `let X =`, `var X =`, `function X(`, с `export` или
        // без. Импорт и реэкспорт под эту форму не попадают.
        if (new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var|function)\\s+${name}\\b`).test(code)) {
          guilty.push(`${path}: ${name}`);
        }
      }
    }
    expect(guilty).toEqual([]);
  });

  it('2. глоб читает исходники, а не пустоту', () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(100);
    expect(FILES['/src/lib/domain/engines.ts']).toContain('LINK_CELLS');
  });

  it('3. охраняемые имена действительно есть в контракте', () => {
    // Иначе сторож переживёт переименование в контракте и замолчит навсегда.
    expect(LINK_CELLS.length).toBeGreaterThan(0);
    expect(LINK_CONGESTIONS.length).toBeGreaterThan(0);
    expect(LINK_UNDERLAYS).toContain(DEFAULT_LINK_UNDERLAY);
    expect(TEMPLATE_TYPES.length).toBeGreaterThan(0);
    expect(XRAY_SUBPROTOCOLS.length).toBeGreaterThan(0);
    expect(XRAY_PLAIN_SUBPROTOCOLS.length).toBeGreaterThan(0);
    expect(CORE_COMPONENTS.length).toBeGreaterThan(0);
    expect(typeof judgeCoreVersion).toBe('function');
    expect(Object.keys(CORE_ENV_PREFIX).length).toBeGreaterThan(0);
    expect(typeof coreEnvPair).toBe('function');
    expect(componentsOfEngine('amneziawg')).toEqual(['amneziawg-module', 'amneziawg-tools']);
    expect(CORE_NODE_DIR.length).toBeGreaterThan(0);
    expect(Object.keys(ENGINE_BOOTSTRAP).length).toBeGreaterThan(0);
    expect(typeof coreInstallCommand).toBe('function');
    expect(REALITY_RECORD_LIMIT).toBeGreaterThan(0);
    expect(REALITY_TARGET_SUGGESTIONS.length).toBeGreaterThan(0);
  });

  it('4. подпротоколы xray не переписываются типом-перечнем', () => {
    // Копия здесь была без имени: `'vless' | 'trojan'` в трёх файлах, уже
    // отставшая от контракта на vmess, socks и http. Ловится сама форма:
    // два подпротокола через `|` в кавычках.
    const pair = new RegExp(
      `'(${XRAY_SUBPROTOCOLS.join('|')})'\\s*\\|\\s*'(${XRAY_SUBPROTOCOLS.join('|')})'`,
    );
    const guilty: string[] = [];
    for (const [path, code] of Object.entries(FILES)) {
      if (path === SELF) continue;
      if (/(^|\n)\s*(export\s+)?type\s+XraySubprotocol\b/.test(code) || pair.test(code)) guilty.push(path);
    }
    expect(guilty).toEqual([]);
  });
});
