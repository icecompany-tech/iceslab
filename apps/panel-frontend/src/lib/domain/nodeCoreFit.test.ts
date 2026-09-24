import { describe, expect, it } from 'vitest';
import { CORE_VERSIONS, type CoreComponent } from '@iceslab/shared';
import { nodeCoreBlocks, nodeCoreFit, nodeCoreFitText } from '@/lib/domain/nodeCoreFit';
import type { Node, NodeCore } from '@/lib/domain/nodes';

const PIN = (c: CoreComponent) => CORE_VERSIONS[c].pinned as string;
const core = (c: Partial<NodeCore> & { name: NodeCore['name'] }): NodeCore => c as NodeCore;
const node = (cores: NodeCore[] | null, coreVersions?: Node['coreVersions']): Pick<Node, 'cores' | 'coreVersions'> =>
  ({ cores: cores === null ? null : { arch: 'amd64', cores }, coreVersions }) as Pick<Node, 'cores' | 'coreVersions'>;
// Keys and their values, so the test reads which sentence was chosen.
const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}${JSON.stringify(opts)}` : key;

describe('nodeCoreFit: the four states the deploy window draws', () => {
  it('не установлено: все строки движка installed: false, галка закрыта', () => {
    const fit = nodeCoreFit(node([core({ name: 'tuic', engine: 'singbox', installed: false })]), 'singbox');
    expect(fit.kind).toBe('missing');
    expect(nodeCoreBlocks(fit)).toBe(true);
    const text = nodeCoreFitText(fit, t);
    expect(text.tone).toBe('amber');
    expect(text.text).toBe('nodeCore.missing{"core":"sing-box"}');
    expect(text.blockWhy).toBe('nodeCore.missingWhy{"core":"sing-box"}');
  });

  it('плохая версия и выше потолка: красный, галка закрыта, причина из манифеста', () => {
    const bad = nodeCoreFit(node([core({ name: 'xray', engine: 'xray', version: '26.9.8' })]), 'xray');
    expect(bad.kind).toBe('refused');
    expect(nodeCoreBlocks(bad)).toBe(true);
    const text = nodeCoreFitText(bad, t);
    expect(text.tone).toBe('red');
    expect(text.text).toBe('nodeCore.refused{"core":"xray","version":"26.9.8"}');
    expect(text.blockWhy).toContain('nodeCore.refusedWhy');
    expect(text.blockWhy).toContain('X25519MLKEM768');

    const awg = nodeCoreFit(
      node([core({ name: 'amneziawg', engine: 'amneziawg', version: PIN('amneziawg-module'), toolsVersion: '2.0.1' })]),
      'amneziawg',
    );
    expect(awg.kind).toBe('refused');
    expect(nodeCoreFitText(awg, t).text).toContain('"version":"nodeCore.part.tools 2.0.1"');
  });

  it('дрейф: янтарь, галка открыта, к пину или к выбранной для ноды', () => {
    const toPin = nodeCoreFit(node([core({ name: 'tuic', engine: 'singbox', version: '1.13.12' })]), 'singbox');
    expect(toPin.kind).toBe('drift');
    expect(nodeCoreBlocks(toPin)).toBe(false);
    expect(nodeCoreFitText(toPin, t)).toEqual({
      tone: 'amber',
      text: `nodeCore.driftPin{"core":"sing-box","version":"1.13.12","target":"${PIN('singbox')}"}`,
      blockWhy: null,
    });

    const toChosen = nodeCoreFit(
      node([core({ name: 'xray', engine: 'xray', version: PIN('xray') })], { xray: '26.2.6' }),
      'xray',
    );
    expect(toChosen.kind).toBe('drift');
    expect(nodeCoreFitText(toChosen, t).text).toContain('nodeCore.driftChosen');
  });

  it('как в пине, как выбрано, без версии: серым, галка открыта', () => {
    const onPin = nodeCoreFit(node([core({ name: 'xray', engine: 'xray', version: PIN('xray') })]), 'xray');
    expect(onPin.kind).toBe('present');
    expect(nodeCoreFitText(onPin, t)).toEqual({
      tone: 'grey',
      text: `nodeCore.onPin{"core":"xray","version":"${PIN('xray')}"}`,
      blockWhy: null,
    });
    const noVersion = nodeCoreFit(node([core({ name: 'xray', engine: 'xray' })]), 'xray');
    expect(nodeCoreFitText(noVersion, t).text).toBe('nodeCore.noVersion{"core":"xray"}');
    const naive = nodeCoreFit(node([core({ name: 'naive', engine: 'naive', version: '2.10.0' })]), 'naive');
    expect(nodeCoreFitText(naive, t).text).toContain('nodeCore.unpinned');
  });

  it('AmneziaWG: модуль и tools одной строкой', () => {
    const fit = nodeCoreFit(
      node([
        core({ name: 'amneziawg', engine: 'amneziawg', version: PIN('amneziawg-module'), toolsVersion: PIN('amneziawg-tools') }),
      ]),
      'amneziawg',
    );
    expect(nodeCoreFitText(fit, t).text).toBe(
      `nodeCore.onPin{"core":"amneziawg","version":"nodeCore.part.module ${PIN('amneziawg-module')}, nodeCore.part.tools ${PIN('amneziawg-tools')}"}`,
    );
  });

  it('нода не сообщила: нет отчёта, нет строки движка, строка без engine. Не отказ', () => {
    for (const n of [
      node(null),
      node([]),
      node([core({ name: 'xray', engine: 'xray', version: PIN('xray') })]),
      node([core({ name: 'tuic', installed: false })]),
    ]) {
      const fit = nodeCoreFit(n, 'singbox');
      expect(fit.kind).toBe('silent');
      expect(nodeCoreBlocks(fit)).toBe(false);
      expect(nodeCoreFitText(fit, t)).toEqual({ tone: 'grey', text: 'nodeCore.silent', blockWhy: null });
    }
  });

  it('одна строка из нескольких стоит: ядро есть', () => {
    const fit = nodeCoreFit(
      node([
        core({ name: 'tuic', engine: 'singbox', installed: false }),
        core({ name: 'anytls', engine: 'singbox', version: PIN('singbox') }),
      ]),
      'singbox',
    );
    expect(fit.kind).toBe('present');
  });
});
