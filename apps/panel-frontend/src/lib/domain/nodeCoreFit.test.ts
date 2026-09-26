import { describe, expect, it } from 'vitest';
import { CORE_VERSIONS, type CoreComponent } from '@iceslab/shared';
import { coreGateRefusal, nodeCoreBlocks, nodeCoreFit, nodeCoreFitText } from '@/lib/domain/nodeCoreFit';
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

describe('coreGateRefusal: the 409 of the BACK core gate', () => {
  const res = (data: unknown, status = 409) => ({ response: { status, data } });
  const cmd = 'sudo env SINGBOX_VERSION=1.13.14 SINGBOX_SHA256=ab bash /opt/iceslab-node/apps/node/scripts/bootstrap-singbox.sh --restart-agent';

  it('CORE_NOT_ON_NODE: node, engine, the server command and whether it is pinned', () => {
    expect(
      coreGateRefusal(
        res({ error: 'CORE_NOT_ON_NODE', message: 'm', nodeName: 'nl-01', engine: 'singbox', howToInstall: { command: cmd, pinned: true } }),
      ),
    ).toEqual({ kind: 'missing', nodeName: 'nl-01', engine: 'singbox', command: cmd, pinned: true, why: null });
    expect(
      coreGateRefusal(
        res({
          error: 'CORE_NOT_ON_NODE',
          nodeName: 'nl-01',
          engine: 'hysteria',
          howToInstall: { command: 'sudo bash x', pinned: false, why: 'no-arch' },
        }),
      ),
    ).toMatchObject({ kind: 'missing', pinned: false, why: 'no-arch' });
  });

  it('CORE_NOT_ON_NODE without a usable howToInstall: the refusal stands, the command is not guessed', () => {
    for (const how of [undefined, null, 'x', { command: 7 }, { command: '  ' }, { command: cmd, why: 'bogus' }]) {
      const r = coreGateRefusal(res({ error: 'CORE_NOT_ON_NODE', nodeName: 'n', engine: 'xray', howToInstall: how }));
      expect(r?.kind).toBe('missing');
      if (r?.kind === 'missing') {
        expect(r.pinned).toBe(false);
        expect(r.why).toBeNull();
      }
    }
  });

  it('CORE_VERSION_REFUSED: version and the manifest reason', () => {
    expect(
      coreGateRefusal(
        res({
          error: 'CORE_VERSION_REFUSED',
          nodeName: 'ru-01',
          engine: 'xray',
          component: 'xray',
          version: '26.9.8',
          verdict: 'known-bad',
          reason: 'ML-KEM',
        }),
      ),
    ).toEqual({ kind: 'refused', nodeName: 'ru-01', engine: 'xray', version: '26.9.8', reason: 'ML-KEM' });
  });

  it('AWG_PROTOCOL_MISMATCH (227054e): node and both generations, no engine in the body', () => {
    expect(
      coreGateRefusal(
        res({ error: 'AWG_PROTOCOL_MISMATCH', message: 'm', nodeName: 'se-01', profileAwgProtocol: 3, nodeAwgProtocol: 1 }),
      ),
    ).toEqual({ kind: 'awg', nodeName: 'se-01', profileAwgProtocol: 3, nodeAwgProtocol: 1 });
  });

  it('AWG_PROTOCOL_MISMATCH with a generation outside the contract or missing: null', () => {
    for (const d of [
      { profileAwgProtocol: 2, nodeAwgProtocol: 1 },
      { profileAwgProtocol: 3, nodeAwgProtocol: null },
      { profileAwgProtocol: '3', nodeAwgProtocol: 1 },
      { nodeAwgProtocol: 1 },
    ]) {
      expect(coreGateRefusal(res({ error: 'AWG_PROTOCOL_MISMATCH', nodeName: 'se-01', ...d }))).toBeNull();
    }
    expect(
      coreGateRefusal(res({ error: 'AWG_PROTOCOL_MISMATCH', profileAwgProtocol: 3, nodeAwgProtocol: 1 })),
    ).toBeNull();
  });

  it('garbage and other answers: null', () => {
    for (const e of [
      null,
      undefined,
      'x',
      new Error('x'),
      res({ error: 'CORE_NOT_ON_NODE', nodeName: 'n', engine: 'xray' }, 400),
      res({ error: 'LINK_PORT_IN_USE', nodeName: 'n', engine: 'xray' }),
      res({ error: 'CORE_NOT_ON_NODE', engine: 'xray' }),
      res({ error: 'CORE_NOT_ON_NODE', nodeName: '', engine: 'xray' }),
      res({ error: 'CORE_NOT_ON_NODE', nodeName: 'n', engine: 'warp' }),
      res(null),
    ]) {
      expect(coreGateRefusal(e)).toBeNull();
    }
  });
});