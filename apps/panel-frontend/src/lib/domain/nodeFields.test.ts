import { describe, expect, it } from 'vitest';
import { listFieldKnown, nodeFieldKnown } from '@/lib/domain/nodeFields';
import type { Node } from '@/lib/domain/nodes';

const node = (n: Partial<Node>) => n as Node;

describe('nodeFieldKnown: знает ли сервер ключ, E29', () => {
  it('пустой парк и fields с intendedEngines: знает, мастер рисует чипы', () => {
    expect(nodeFieldKnown({ nodes: [], fields: ['awgProtocol', 'coreVersions', 'intendedEngines'] }, 'intendedEngines')).toBe(true);
  });

  it('пустой парк без fields (сервер старше): не знает, старая форма', () => {
    expect(nodeFieldKnown({ nodes: [] }, 'intendedEngines')).toBe(false);
  });

  it('парк с нодами без fields: как раньше, по ключу у ноды', () => {
    expect(nodeFieldKnown({ nodes: [node({ intendedEngines: ['xray'] })] }, 'intendedEngines')).toBe(true);
    expect(nodeFieldKnown({ nodes: [node({})] }, 'intendedEngines')).toBe(false);
  });

  it('fields без этого имени не отменяет факта по нодам; кривой fields не факт', () => {
    expect(nodeFieldKnown({ nodes: [node({ awgProtocol: 1 })], fields: ['coreVersions'] }, 'awgProtocol')).toBe(true);
    expect(nodeFieldKnown({ nodes: [], fields: 'intendedEngines' }, 'intendedEngines')).toBe(false);
    expect(nodeFieldKnown({ nodes: [], fields: [1, 'intendedEngines'] }, 'intendedEngines')).toBe(false);
  });

  it('то же правило у каскадов (listFieldKnown): fields первым, по элементам только без fields', () => {
    expect(listFieldKnown(['entryPolicy'], [], 'entryPolicy')).toBe(true);
    expect(listFieldKnown(undefined, [], 'entryPolicy')).toBe(false);
    expect(listFieldKnown(undefined, [{ entryPolicy: null }], 'entryPolicy')).toBe(true);
    expect(listFieldKnown(['tunnels'], [{}], 'entryPolicy')).toBe(false);
  });

  it('ответа ещё нет: не знает', () => {
    expect(nodeFieldKnown(undefined, 'awgProtocol')).toBe(false);
  });
});
