import { describe, expect, it } from 'vitest';
import type { NodeCoreInfo } from '@iceslab/shared';
import { cardEngines, ENGINE_SHORT, engineVersionLines, fitEngineNames } from '@/contours/nodes/lib/nodeCardEngines';

const SEVEN = ['mtproto', 'mieru', 'naive', 'amneziawg', 'singbox', 'hysteria', 'xray'] as const;

describe('cardEngines: ядра карточки в порядке ENGINE_NAMES (E44)', () => {
  it('порядок не зависит от хранения, короткие имена', () => {
    expect(cardEngines(['amneziawg', 'hysteria', 'xray']).map((e) => ENGINE_SHORT[e])).toEqual(['xray', 'hy2', 'awg']);
    expect(cardEngines([...SEVEN]).map((e) => ENGINE_SHORT[e])).toEqual([
      'xray',
      'hy2',
      'sb',
      'awg',
      'naive',
      'mieru',
      'mtg',
    ]);
    expect(cardEngines([])).toEqual([]);
  });
});

describe('fitEngineNames: сколько влезает, остальное «+N»', () => {
  const names = ['xray', 'hy2', 'sb', 'awg', 'naive', 'mieru', 'mtg'];

  it('всё влезает: без хвоста', () => {
    expect(fitEngineNames(names, 40)).toEqual({ shown: names, rest: 0 });
    // Ровно по длине: «xray hy2 awg» 12 знаков.
    expect(fitEngineNames(['xray', 'hy2', 'awg'], 12)).toEqual({ shown: ['xray', 'hy2', 'awg'], rest: 0 });
  });

  it('не влезает: имена целиком и «+N», хвост тоже считается в ширину', () => {
    // «xray hy2 +1» 11 знаков, «xray hy2 awg» 12.
    expect(fitEngineNames(['xray', 'hy2', 'awg'], 11)).toEqual({ shown: ['xray', 'hy2'], rest: 1 });
    // «xray hy2 sb +4» 14 знаков.
    expect(fitEngineNames(names, 15)).toEqual({ shown: ['xray', 'hy2', 'sb'], rest: 4 });
    expect(fitEngineNames(names, 3)).toEqual({ shown: [], rest: 7 });
  });

  it('ширина ещё не измерена: показать всё, «+N» не выдумывать', () => {
    expect(fitEngineNames(names, 0)).toEqual({ shown: names, rest: 0 });
    expect(fitEngineNames(names, Number.NaN)).toEqual({ shown: names, rest: 0 });
  });
});

describe('engineVersionLines: версии в подсказке из cores[]', () => {
  const cores: NodeCoreInfo[] = [
    { name: 'shadowsocks', engine: 'xray' },
    { name: 'xray', engine: 'xray', version: '26.3.27' },
    { name: 'amneziawg', engine: 'amneziawg', version: '1.0.20250901', toolsVersion: '1.0.20250706' },
  ];

  it('первая строка ядра с версией, у awg утилиты отдельно, без версии null', () => {
    expect(engineVersionLines(['amneziawg', 'hysteria', 'xray'], cores)).toEqual([
      { engine: 'xray', version: '26.3.27' },
      { engine: 'hysteria', version: null },
      { engine: 'amneziawg', version: '1.0.20250901, tools 1.0.20250706' },
    ]);
  });

  it('нода не сообщала: версии null у всех', () => {
    expect(engineVersionLines(['singbox'], undefined)).toEqual([{ engine: 'sing-box', version: null }]);
  });
});
