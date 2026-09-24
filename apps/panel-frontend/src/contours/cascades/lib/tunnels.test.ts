import { describe, expect, it } from 'vitest';
import { tunnelNotFound, tunnelRows } from '@/contours/cascades/lib/tunnels';
import type { CascadeTunnel } from '@/lib/domain/cascades';

const nodes = new Map([
  ['a', { name: 'ru-01' }],
  ['b', { name: 'se-01' }],
  ['c', { name: 'nl-01' }],
]);
const tunnel = (from: string, to: string, open: boolean, n: number): CascadeTunnel => ({
  fromNodeId: from,
  toNodeId: to,
  iface: `awg-l${n}`,
  network: `10.77.0.${n * 4}/30`,
  fromAddress: `10.77.0.${n * 4 + 1}`,
  toAddress: `10.77.0.${n * 4 + 2}`,
  port: 27000 + n,
  publicLinkPortOpen: open,
});

describe('tunnelRows: туннели каскада по парам нод', () => {
  it('пусто и сервер без поля: строк нет, блока нет', () => {
    expect(tunnelRows([], nodes)).toEqual({ rows: [], openPorts: [] });
    expect(tunnelRows(undefined, nodes)).toEqual({ rows: [], openPorts: [] });
  });

  it('пара: имена нод, интерфейс, подсеть, адреса и порт; порт ноги закрыт', () => {
    const { rows, openPorts } = tunnelRows([tunnel('a', 'b', false, 1)], nodes);
    expect(rows).toEqual([
      {
        key: 'a>b',
        fromNodeId: 'a',
        toNodeId: 'b',
        fromName: 'ru-01',
        toName: 'se-01',
        iface: 'awg-l1',
        network: '10.77.0.4/30',
        fromAddress: '10.77.0.5',
        toAddress: '10.77.0.6',
        port: 27001,
        publicLinkPortOpen: false,
      },
    ]);
    expect(openPorts).toEqual([]);
  });

  it('смешанный случай: открытый порт назван по принимающей ноде один раз; неизвестная нода коротким id', () => {
    const { rows, openPorts } = tunnelRows(
      [tunnel('a', 'b', true, 1), tunnel('c', 'b', true, 2), tunnel('b', 'zzzzzzzz-long', false, 3)],
      nodes,
    );
    expect(rows.map((r) => `${r.fromName}>${r.toName}`)).toEqual(['ru-01>se-01', 'nl-01>se-01', 'se-01>zzzzzzzz']);
    expect(openPorts).toEqual(['se-01']);
  });
});

describe('tunnelNotFound', () => {
  const res = (data: unknown, status = 404) => ({ response: { status, data } });
  it('404 TUNNEL_NOT_FOUND: фраза сервера; прочее null', () => {
    expect(tunnelNotFound(res({ error: 'TUNNEL_NOT_FOUND', message: 'no tunnel between a and b' }))).toBe(
      'no tunnel between a and b',
    );
    for (const e of [null, 'x', new Error('x'), res({ error: 'NOT_FOUND' }), res({ error: 'TUNNEL_NOT_FOUND' }, 409), res(null)]) {
      expect(tunnelNotFound(e)).toBeNull();
    }
  });
});
