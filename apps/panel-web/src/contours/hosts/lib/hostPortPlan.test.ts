import { describe, expect, it } from 'vitest';
import { hostPortPlan } from '@/contours/hosts/lib/hostPortPlan';

// One profile on node n1 twice: 443 (hosts direct, cdn) and 8443 (host alt).
const bindings = [
  { id: 'b443', profileId: 'p', nodeId: 'n1', port: 443 },
  { id: 'b8443', profileId: 'p', nodeId: 'n1', port: 8443 },
  { id: 'other', profileId: 'q', nodeId: 'n1', port: 9443 },
];
const hosts = [
  { id: 'h1', bindingId: 'b443', remark: 'direct' },
  { id: 'h2', bindingId: 'b443', remark: 'cdn' },
  { id: 'h3', bindingId: 'b8443', remark: 'alt' },
];
const base = { bindings, hosts, profileId: 'p', nodeId: 'n1', self: null, move: 'host' as const };

describe('hostPortPlan (A-259): профиль на ноде стоит столько раз, сколько у него портов', () => {
  it('создание: порт, на котором профиль уже слушает, ставит хост к его хостам', () => {
    expect(hostPortPlan({ ...base, port: 8443 })).toEqual({ kind: 'join', port: 8443, hosts: ['alt'] });
  });
  it('создание: другой порт это ещё один инбаунд, названы порты, где профиль уже стоит', () => {
    expect(hostPortPlan({ ...base, port: 2053 })).toEqual({ kind: 'newInbound', port: 2053, ports: [443, 8443] });
  });
  it('создание: профиль на ноде впервые, сказать нечего; без ноды, профиля или порта тоже', () => {
    expect(hostPortPlan({ ...base, nodeId: 'n2', port: 443 })).toBeNull();
    expect(hostPortPlan({ ...base, nodeId: null, port: 443 })).toBeNull();
    expect(hostPortPlan({ ...base, port: '' })).toBeNull();
  });
  it('правка: порт не менялся, плана нет', () => {
    expect(hostPortPlan({ ...base, port: 443, self: { hostId: 'h1', bindingId: 'b443' } })).toBeNull();
  });
  it('правка по умолчанию уводит только этот хост, остальные названы и остаются', () => {
    expect(hostPortPlan({ ...base, port: 2053, self: { hostId: 'h1', bindingId: 'b443' } })).toEqual({
      kind: 'split',
      port: 2053,
      from: 443,
      others: ['cdn'],
    });
  });
  it('правка «весь инбаунд»: двигается со всеми хостами', () => {
    expect(hostPortPlan({ ...base, port: 2053, self: { hostId: 'h1', bindingId: 'b443' }, move: 'binding' })).toEqual({
      kind: 'moveAll',
      port: 2053,
      from: 443,
      others: ['cdn'],
    });
  });
  it('правка на порт соседней привязки той же пары: хост встаёт к ней', () => {
    expect(hostPortPlan({ ...base, port: 8443, self: { hostId: 'h1', bindingId: 'b443' } })).toEqual({
      kind: 'join',
      port: 8443,
      hosts: ['alt'],
    });
  });
  it('один хост на инбаунде: перенос без выбора; чужой профиль на том же порту не соседство', () => {
    expect(hostPortPlan({ ...base, port: 2053, self: { hostId: 'h3', bindingId: 'b8443' } })).toBeNull();
    expect(hostPortPlan({ ...base, port: 9443, self: { hostId: 'h3', bindingId: 'b8443' } })).toBeNull();
  });
  it('привязки хоста нет в списке: неизвестно, плана нет', () => {
    expect(hostPortPlan({ ...base, port: 2053, self: { hostId: 'h1', bindingId: 'gone' } })).toBeNull();
  });
});

describe('A-259: экран не ищет привязку по паре профиль и нода', () => {
  // Every `.find(` whose predicate compares both profileId and nodeId must
  // also compare the port: the pair alone names no binding any more.
  const FILES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('ни одного .find по паре без порта', () => {
    const hits: string[] = [];
    for (const [file, src] of Object.entries(FILES)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      for (const m of src.matchAll(/\.find\(/g)) {
        const body = src.slice(m.index, m.index + 300).split(/\)\s*[;,\n]\s*(?:\n|$)/)[0] ?? '';
        if (/\.profileId\s*===/.test(body) && /\.nodeId\s*===/.test(body) && !/\.port\s*===/.test(body)) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
