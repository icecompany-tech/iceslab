import { describe, expect, it } from 'vitest';
import { hostEditGate, hostsBarCounts, listsArrived } from '@/contours/hosts/lib/hostsView';
import { portConflict } from '@/lib/old/hosts';
import { coreGateRefusal, coreGateText } from '@/lib/old/nodeCoreFit';

describe('listsArrived (A-247)', () => {
  it('факт есть, только когда пришли все списки; пустой список это пришедший', () => {
    expect(listsArrived({ data: { bindings: [] } }, { data: { nodes: [] } })).toBe(true);
    expect(listsArrived({ data: { bindings: [] } }, { data: undefined })).toBe(false);
    expect(listsArrived({ data: undefined }, { data: { profiles: [] } })).toBe(false);
  });
});

describe('coreGateText (A-235): отказ ядра для ноды не из списка словами, не «порт занят»', () => {
  const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;
  it('нет ядра: путь к строке установки; версия отклонена: версия', () => {
    const missing = coreGateRefusal({
      response: { status: 409, data: { error: 'CORE_NOT_ON_NODE', nodeName: 'x', engine: 'singbox', howToInstall: { command: 'c' } } },
    })!;
    expect(coreGateText(missing, t)).toBe('nodeCore.gateMissingToast {"node":"x","core":"sing-box"}');
    const refused = coreGateRefusal({
      response: { status: 409, data: { error: 'CORE_VERSION_REFUSED', nodeName: 'x', engine: 'xray', version: '1.0', reason: 'old' } },
    })!;
    expect(coreGateText(refused, t)).toBe('nodeCore.gateRefused {"node":"x","core":"xray","version":"1.0"}');
  });
});

const ok = (data: unknown) => ({ data, isError: false });
const failed = { data: undefined, isError: true };
const pending = { data: undefined, isError: false };

describe('hostsBarCounts (A-234)', () => {
  const online = { status: 'online' };
  const row = (enabled: boolean, nodes: { status: string }[], nodesKnown = true) => ({ host: { enabled }, nodes, nodesKnown });

  it('с известными нодами: живые, деградировавшие и сироты по фактам', () => {
    expect(hostsBarCounts([row(true, [online]), row(true, [{ status: 'offline' }]), row(true, [])], true)).toEqual({
      live: 1,
      degraded: 1,
      orphaned: 1,
    });
  });

  it('без ответа привязок или нод: «живых» «-», сирот 0, а не каждый хост', () => {
    const rows = [row(true, [], false), row(true, [], false)];
    expect(hostsBarCounts(rows, false)).toEqual({ live: '-', degraded: 0, orphaned: 0 });
  });
});

describe('hostEditGate (A-234)', () => {
  const all = { hosts: ok({}), bindings: ok({}), nodes: ok({}), profiles: ok({}) };

  it('форма открывается, только когда ответили все списки', () => {
    expect(hostEditGate(false, all, true).view.kind).toBe('ready');
    expect(hostEditGate(false, { ...all, profiles: pending }, true).view.kind).toBe('loading');
    expect(hostEditGate(true, { ...all, hosts: failed, bindings: failed, nodes: pending }, false).view.kind).toBe('loading');
  });

  it('сбой называет свой список: новый хост ждёт ноды и профили, существующий ещё хосты и привязки', () => {
    expect(hostEditGate(true, { ...all, profiles: failed }, false).failed).toBe('profiles');
    expect(hostEditGate(true, { ...all, hosts: failed, bindings: failed }, false).failed).toBeNull();
    expect(hostEditGate(false, { ...all, nodes: failed }, true).failed).toBe('nodes');
    expect(hostEditGate(false, { ...all, hosts: failed }, true).failed).toBe('hosts');
  });

  it('«не найден» только когда список хостов пришёл без хоста', () => {
    expect(hostEditGate(false, all, false).view.kind).toBe('gone');
  });
});

describe('portConflict (A-235): в поле порта попадает только порт', () => {
  const res = (error: string, extra: Record<string, unknown> = {}) => ({
    response: { status: 409, data: { error, message: `said ${error}`, ...extra } },
  });

  it('коды порта дают слова сервера', () => {
    for (const code of ['PORT_IN_USE', 'PORT_TAKEN_PROFILE', 'PORT_TAKEN_CASCADE', 'PORT_TAKEN_CORE_SERVICE']) {
      expect(portConflict(res(code))).toBe(`said ${code}`);
    }
  });

  it('прочие 409 не порт', () => {
    for (const code of [
      'MIERU_MTU_MISMATCH',
      'ADAPTER_SLOT_TAKEN',
      'CORE_NOT_ON_NODE',
      'CORE_VERSION_REFUSED',
      'AWG_PROTOCOL_MISMATCH',
      'PROFILE_DOES_NOT_RUN_ON_NODE',
      'HOST_PORT_SHARED',
      'CONFLICT',
    ]) {
      expect(portConflict(res(code)), code).toBeNull();
    }
    expect(portConflict({ response: { status: 409, data: { message: 'no code' } } })).toBeNull();
    expect(portConflict({ response: { status: 400, data: { error: 'PORT_IN_USE' } } })).toBeNull();
    expect(portConflict(null)).toBeNull();
  });
});
