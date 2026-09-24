import { describe, expect, it } from 'vitest';
import { nodeDeleteFacts, nodeDeleteRefusal } from '@/contours/nodes/lib/nodeDelete';

const res = (data: unknown, status = 409) => ({ response: { status, data } });
const c = (id: string, name: string, enabled: boolean) => ({ id, name, enabled });

describe('nodeDeleteRefusal: 409 NODE_IN_USE_BY_CASCADE', () => {
  it('тело с каскадами: имена для тоста (тело как у nodes.routes.ts на стенде)', () => {
    expect(
      nodeDeleteRefusal(res({ error: 'NODE_IN_USE_BY_CASCADE', message: 'Node "se-01" is part of…', cascades: ['123'] })),
    ).toEqual({ cascades: ['123'], message: 'Node "se-01" is part of…' });
  });

  it('тело без каскадов или с мусором в них: пустой список, тост общими словами', () => {
    expect(nodeDeleteRefusal(res({ error: 'NODE_IN_USE_BY_CASCADE' }))).toEqual({ cascades: [], message: '' });
    expect(nodeDeleteRefusal(res({ error: 'NODE_IN_USE_BY_CASCADE', cascades: [7, '', 'eu'] }))?.cascades).toEqual(['eu']);
  });

  it('вход проверяется первым: мусор и чужие отказы дают null', () => {
    for (const e of [null, undefined, 'x', new Error('Request failed with status code 409'), { response: null }]) {
      expect(nodeDeleteRefusal(e)).toBeNull();
    }
    expect(nodeDeleteRefusal(res({ error: 'NODE_IN_USE_BY_CASCADE' }, 400))).toBeNull();
    expect(nodeDeleteRefusal(res({ error: 'NODE_NOT_FOUND' }))).toBeNull();
  });
});

describe('nodeDeleteFacts: каскады ноды до кнопки', () => {
  it('включённый каскад запрещает, выключенный только называется; одно имя на каскад', () => {
    expect(
      nodeDeleteFacts({
        cascadeNeedsEngines: [
          { engine: 'xray', cascades: [c('a', '123', true), c('b', 'old', false)] },
          { engine: 'singbox', cascades: [c('a', '123', true)] },
        ],
      }),
    ).toEqual({ blocked: ['123'], disabled: ['old'] });
  });

  it('нода ни в одном каскаде: ничего не мешает', () => {
    expect(nodeDeleteFacts({ cascadeNeedsEngines: [] })).toEqual({ blocked: [], disabled: [] });
  });

  it('поля нет: окно как раньше, отсутствие не факт', () => {
    expect(nodeDeleteFacts({})).toBeNull();
  });
});
