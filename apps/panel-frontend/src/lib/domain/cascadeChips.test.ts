import { describe, expect, it } from 'vitest';
import { cascadeNodeChips, coreChipText, legEngine } from '@/lib/domain/cascadeChips';
import type { Node, NodeCore } from '@/lib/domain/nodes';

const core = (c: Partial<NodeCore> & { name: NodeCore['name'] }): NodeCore => c as NodeCore;
// A node with three cores, as the owner's frame had it.
const node = {
  coreVersion: '26.3.27',
  cores: {
    cores: [
      core({ name: 'xray', engine: 'xray', version: '26.3.27' }),
      core({ name: 'amneziawg', engine: 'amneziawg', version: '1.0.20260611' }),
      core({ name: 'tuic', engine: 'singbox', version: '1.13.14' }),
      core({ name: 'hysteria', engine: 'hysteria', installed: false }),
    ],
  },
} as unknown as Pick<Node, 'cores' | 'coreVersion'>;
const texts = (r: ReturnType<typeof cascadeNodeChips>) => ({
  shown: r.shown.map(coreChipText),
  others: r.others.map(coreChipText),
});

describe('cascadeNodeChips: only the cores the cascade uses on the node', () => {
  it('вход: движок протокола входа и движок ноги, которую он набирает', () => {
    expect(texts(cascadeNodeChips(node, 'entry', { entryProtocol: 'xray', outLeg: 'hy2' }))).toEqual({
      shown: ['xray 26.3.27', 'sing-box 1.13.14'],
      others: ['AWG 1.0.20260611'],
    });
    // shadowsocks is served by xray; an unset cell is the vless leg on xray.
    expect(texts(cascadeNodeChips(node, 'entry', { entryProtocol: 'shadowsocks', outLeg: null })).shown).toEqual([
      'xray 26.3.27',
    ]);
    expect(texts(cascadeNodeChips(node, 'entry', { entryProtocol: 'amneziawg', outLeg: 'vless' })).shown).toEqual([
      'AWG 1.0.20260611',
      'xray 26.3.27',
    ]);
  });

  it('транзит: нога, на которую его набирают, и нога, которую набирает он', () => {
    expect(texts(cascadeNodeChips(node, 'transit', { inLeg: 'hy2', outLeg: 'tuic' }))).toEqual({
      shown: ['sing-box 1.13.14'],
      others: ['xray 26.3.27', 'AWG 1.0.20260611'],
    });
  });

  it('выход: только нога, на которую его набирают; не установленное ядро не в «ещё на ноде»', () => {
    const r = texts(cascadeNodeChips(node, 'exit', { inLeg: 'shadowsocks', outLeg: 'tuic' }));
    expect(r.shown).toEqual(['xray 26.3.27']);
    expect(r.others).not.toContain('hysteria');
  });

  it('нога, которой экран не знает, ничего не добавляет; нода без отчёта: xray со своей coreVersion, без чужих', () => {
    expect(cascadeNodeChips(node, 'entry', { entryProtocol: 'xray' }).shown.map((c) => c.engine)).toEqual(['xray']);
    const silent = { coreVersion: '26.3.27', cores: null } as unknown as Pick<Node, 'cores' | 'coreVersion'>;
    expect(texts(cascadeNodeChips(silent, 'entry', { entryProtocol: 'xray', outLeg: 'hy2' }))).toEqual({
      shown: ['xray 26.3.27', 'sing-box'],
      others: [],
    });
  });

  it('нога внутри AmneziaWG: AWG у обеих нод пары, у выхода по входящей ноге', () => {
    expect(
      texts(cascadeNodeChips(node, 'entry', { entryProtocol: 'xray', outLeg: 'vless', outUnderlay: 'awg' })).shown,
    ).toEqual(['xray 26.3.27', 'AWG 1.0.20260611']);
    expect(texts(cascadeNodeChips(node, 'exit', { inLeg: 'vless', inUnderlay: 'awg' })).shown).toEqual([
      'xray 26.3.27',
      'AWG 1.0.20260611',
    ]);
    // Входящая нога входа не бывает: подложка входа это только его исходящая.
    expect(
      texts(cascadeNodeChips(node, 'entry', { entryProtocol: 'xray', outLeg: 'vless', inUnderlay: 'awg' })).shown,
    ).toEqual(['xray 26.3.27']);
  });

  it('ячейки ног: vless и shadowsocks у xray, hy2 и tuic у sing-box', () => {
    expect(['vless', 'xray', 'shadowsocks', null].map(legEngine)).toEqual(['xray', 'xray', 'xray', 'xray']);
    expect(['hy2', 'tuic'].map(legEngine)).toEqual(['singbox', 'singbox']);
  });
});
