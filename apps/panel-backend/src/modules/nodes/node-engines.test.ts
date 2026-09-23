import { describe, it, expect } from 'vitest';
import { reportedEngines } from './node-engines.js';
import { canRunChainAtSave } from '../cascades/cell-carriage.js';

const report = (...cores: Record<string, unknown>[]) => ({
  cores: { at: '2026-09-23T00:00:00.000Z', cores: cores.map((c) => ({ running: false, ...c })) },
});

/**
 * Since 2026-09-23 the agent names every engine it knows, a missing one as a
 * row with `installed: false`. Such a row is a fact about the machine, and the
 * fact is "not here": counting it as an engine the node runs would make every
 * gate that asks "is sing-box on this node" answer yes on a node without it.
 */
describe('the engines a node reported', () => {
  it('leaves out an engine the node says is not installed', () => {
    const node = report(
      { name: 'xray', engine: 'xray', installed: true },
      { name: 'tuic', engine: 'singbox', installed: false },
      { name: 'hysteria', engine: 'hysteria', installed: false },
    );
    expect(reportedEngines(node)).toEqual(['xray']);
  });

  it('still counts a core that does not say, as an agent older than the field', () => {
    expect(reportedEngines(report({ name: 'xray', engine: 'xray' }))).toEqual(['xray']);
  });

  it('answers an empty list for a node where nothing is installed: complete, and none', () => {
    const node = report(
      { name: 'xray', engine: 'xray', installed: false },
      { name: 'tuic', engine: 'singbox', installed: false },
    );
    expect(reportedEngines(node)).toEqual([]);
  });

  it('lets the chain gate refuse a node whose sing-box row says not installed', () => {
    // The gate this matters for: before the change, the row alone would have
    // put "singbox" among the engines and let a hysteria entry through onto a
    // machine that cannot run the chain.
    const node = {
      ...report({ name: 'xray', engine: 'xray', installed: true }, { name: 'tuic', engine: 'singbox', installed: false }),
      chainStatus: null,
    };
    const verdict = canRunChainAtSave(node);
    expect(verdict.ok).toBe(false);
    expect(verdict.by).toBe('engines');
  });
});
