import { describe, expect, it } from 'vitest';
import { nodePolicyBand, routeRows, type RouteRow } from '@/contours/nodes/lib/routeRows';
import type { NodePolicy, PolicyDrawing } from '@/lib/old/nodePolicies';

const match = (domain: string[]) => ({ domain, ip: [], port: null, protocol: [], network: null });
const policy: NodePolicy = {
  id: 'cascade-test',
  name: 'cascade-test',
  description: null,
  rules: [
    { id: 'r2', position: 1, enabled: true, match: match(['geosite:ru']), action: { kind: 'direct', directionId: null } },
    { id: 'r1', position: 0, enabled: true, match: match(['ifconfig.me']), action: { kind: 'block', directionId: null } },
    { id: 'r3', position: 2, enabled: false, match: match(['off.example']), action: { kind: 'block', directionId: null } },
    { id: 'r4', position: 3, enabled: true, match: match([]), action: { kind: 'cascade', directionId: 'd', directionLabel: 'SE' } },
  ],
  createdAt: '',
  updatedAt: '',
};
const q = (data: unknown, isError = false) => ({ data, isError, error: isError ? new Error('down') : null, refetch: () => undefined });
const drawing = (over: Partial<PolicyDrawing> = {}): PolicyDrawing => ({
  policyId: 'cascade-test',
  drawing: 'handover',
  notDrawn: [],
  ungated: [],
  agent: null,
  ...over,
});
const say = (e: unknown) => (e instanceof Error ? e.message : 'x');
const kinds = (rows: RouteRow[]) =>
  rows.map((r) => (r.kind === 'policyRule' ? `rule:${r.rule.match.join(',') || '*'}->${r.rule.action}` : r.kind === 'catchAll' ? `else->${r.to}` : r.kind));

describe('routeRows (A-263): порядок агента, config.go:907-941', () => {
  const p = nodePolicyBand('cascade-test', q({ policies: [policy] }), drawing(), say);

  it('вход цепи: QUIC, политика ноды, затем «Всё остальное» в направление; «ifconfig.me -> в никуда» выше «Всё остальное»', () => {
    const rows = kinds(routeRows({ role: 'entry', isBalancerEntry: false, squadPolicy: null, nodePolicy: p }));
    expect(rows).toEqual(['quic', 'policyBand', 'rule:ifconfig.me->block', 'rule:geosite:ru->direct', 'rule:*->cascade', 'else->direction']);
  });
  it('вход балансировщика: узкие правила сквада выше политики ноды, двери ниже', () => {
    const squadPolicy = { policy: { id: 's', name: 'ads', ordinal: 1, blockDomains: ['ads.example'], directDomains: [] } as never, squads: ['main'] };
    const rows = kinds(routeRows({ role: 'entry', isBalancerEntry: true, squadPolicy, nodePolicy: p }));
    expect(rows.indexOf('squadBlock')).toBeLessThan(rows.indexOf('policyBand'));
    expect(rows.indexOf('rule:ifconfig.me->block')).toBeLessThan(rows.indexOf('else->exits'));
    expect(rows[0]).toBe('quic');
  });
  it('транзит и выход: политика выше линка; вне каскада: политика, затем дверь ноды', () => {
    expect(kinds(routeRows({ role: 'exit', isBalancerEntry: false, squadPolicy: null, nodePolicy: p })).slice(-2)).toEqual(['fromLink', 'else->nothing']);
    expect(kinds(routeRows({ role: null, isBalancerEntry: false, squadPolicy: null, nodePolicy: p })).at(-1)).toBe('else->egress');
  });
});

describe('nodePolicyBand (A-263): политика ноды, вход первым', () => {
  it('выключенное правило не едет на ноду и не показано; порядок по position', () => {
    const { band, rules } = nodePolicyBand('cascade-test', q({ policies: [policy] }), drawing(), say);
    expect(band).toEqual({ kind: 'ready', name: 'cascade-test', drawingKnown: true });
    expect(rules.map((r) => r.ruleId)).toEqual(['r1', 'r2', 'r4']);
    expect(rules[2]!.direction).toBe('SE');
  });
  it('правило из notDrawn (панель или policy_drawn агента) помечено, не скрыто', () => {
    const panel = nodePolicyBand('cascade-test', q({ policies: [policy] }), drawing({ notDrawn: [{ ruleId: 'r4', reason: 'direction-not-dialled' }] }), say);
    expect(panel.rules.map((r) => [r.ruleId, r.notDrawn])).toEqual([['r1', false], ['r2', false], ['r4', true]]);
    const agent = nodePolicyBand(
      'cascade-test',
      q({ policies: [policy] }),
      drawing({ agent: { drawing: 'handover', notDrawn: [{ exit: 'se', direction: 1, ruleIds: ['r1'] }], renderedAt: '', observedAt: '' } }),
      say,
    );
    expect(agent.rules.find((r) => r.ruleId === 'r1')?.notDrawn).toBe(true);
  });
  it('A-277: nobody-may-take несёт свою причину; ungated помечено, но нарисовано', () => {
    const d = drawing({ notDrawn: [{ ruleId: 'r4', reason: 'nobody-may-take' }], ungated: ['r1'] });
    const rows = nodePolicyBand('cascade-test', q({ policies: [policy] }), d, say).rules;
    expect(rows.find((r) => r.ruleId === 'r4')).toMatchObject({ notDrawn: true, notDrawnReason: 'nobody-may-take', ungated: false });
    expect(rows.find((r) => r.ruleId === 'r1')).toMatchObject({ notDrawn: false, notDrawnReason: null, ungated: true });
    // A server older than the field: nothing is marked ungated.
    const old = nodePolicyBand('cascade-test', q({ policies: [policy] }), drawing({ ungated: null }), say).rules;
    expect(old.every((r) => r.ungated === false)).toBe(true);
  });
  it('рисунок не прочитан или про другую политику: метки нет (null), а не «нарисовано»', () => {
    expect(nodePolicyBand('cascade-test', q({ policies: [policy] }), null, say).rules.every((r) => r.notDrawn === null)).toBe(true);
    const other = nodePolicyBand('cascade-test', q({ policies: [policy] }), drawing({ policyId: 'old' }), say);
    expect(other.band).toEqual({ kind: 'ready', name: 'cascade-test', drawingKnown: false });
  });
  it('политики нет: «-»; список в пути, упал или без неё: сказано, правил нет', () => {
    expect(nodePolicyBand(null, q({ policies: [policy] }), null, say).band.kind).toBe('none');
    expect(nodePolicyBand('cascade-test', q(undefined), null, say).band.kind).toBe('loading');
    const failed = nodePolicyBand('cascade-test', q(undefined, true), null, say).band;
    expect(failed.kind === 'failed' && failed.message).toBe('down');
    expect(nodePolicyBand('gone', q({ policies: [policy] }), null, say)).toEqual({ band: { kind: 'missing' }, rules: [] });
    expect(nodePolicyBand('cascade-test', q({ nope: 1 }), null, say).band.kind).toBe('missing');
  });
});
