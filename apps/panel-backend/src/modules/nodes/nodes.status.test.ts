import { describe, expect, it } from 'vitest';
import { RESOLVER_DOWN_REASON } from '@iceslab/shared';
import {
  capStatusMessage,
  STATUS_MESSAGE_MAX,
  statusFromHealth,
  UNNAMED_DEGRADED,
} from './nodes.cron.js';

/**
 * A node's status has to answer "is this serving anybody", not just "did the
 * agent pick up the phone".
 *
 * On 2026-08-15 a cascade entry's core was dead for hours: rejected config,
 * five crash restarts, then the supervisor left it down. The panel showed the
 * card green the whole time, because the agent was answering and the status
 * only ever had two values. The detail existed - the poller already wrote
 * "not running: xray" into the message - but a message nobody reads is not a
 * status.
 *
 * `degraded` deliberately does NOT mean "stop serving it": the subscription's
 * liveness filter keys on `unreachable`, so the node keeps handing out its
 * working endpoints, and the poller's re-push includes it, because a core that
 * will not start is exactly the one waiting for a config it can load. Those two
 * rules live at their call sites in nodes.cron / subscription.service.
 */
describe('statusFromHealth', () => {
  it('is online when the agent says everything runs', () => {
    expect(statusFromHealth({ status: 'ok', cores: [] })).toEqual({
      status: 'online',
      message: null,
    });
  });

  it('is degraded when a configured core is not running, and names it', () => {
    // The regression: this used to come back 'online' with the detail buried in
    // a message, so the node list showed green while the proxy served nobody.
    const v = statusFromHealth({
      status: 'degraded',
      cores: [
        { name: 'xray', running: false, provisioned: true },
        { name: 'shadowsocks', running: true, provisioned: true },
      ],
    });
    expect(v.status).toBe('degraded');
    expect(v.message).toBe('not running: xray');
  });

  it('names every core that is down, not just the first', () => {
    const v = statusFromHealth({
      status: 'degraded',
      cores: [
        { name: 'xray', running: false, provisioned: true },
        { name: 'hysteria', running: false, provisioned: true },
      ],
    });
    expect(v.message).toBe('not running: xray, hysteria');
  });

  it('does not blame a core nobody configured', () => {
    // A fresh node registers every adapter it could serve; an unprovisioned one
    // is idle by design, and "not running: mieru" would read as an outage on a
    // node that is simply waiting for its first binding.
    //
    // With nothing to name, the raw answer is kept instead - so assert on the
    // accusation, not on the string as a whole (the payload mentions the core
    // because it is the agent's own words).
    const v = statusFromHealth({
      status: 'degraded',
      cores: [{ name: 'mieru', running: false, provisioned: false }],
    });
    expect(v.message).not.toContain('not running: mieru');
  });

  it('treats a core with no provisioned flag as configured', () => {
    // An agent older than that field. Reading absence as "unconfigured" would
    // silently stop reporting real outages on the nodes least likely to be
    // updated.
    const v = statusFromHealth({
      status: 'degraded',
      cores: [{ name: 'xray', running: false }],
    });
    expect(v.message).toBe('not running: xray');
  });

  it('says in words that the agent named no cause (E38)', () => {
    // The raw answer used to be the message, cut mid-JSON at 160 characters.
    // Now the message says what is known, and the poller logs the answer.
    const v = statusFromHealth({ status: 'degraded', cores: [] });
    expect(v).toEqual({ status: 'degraded', message: UNNAMED_DEGRADED });
    expect(v.message).toBe('agent reports degraded without a core reason');
  });

  it("carries the node's own reason when every core runs (E37)", () => {
    // nl-01, 25.09: the host's resolver stopped answering, every xray host died,
    // every core ran, and the node read online. The agent now says why.
    const v = statusFromHealth({
      status: 'degraded',
      cores: [{ name: 'xray', running: true, provisioned: true }],
      reason: RESOLVER_DOWN_REASON,
    });
    expect(v).toEqual({ status: 'degraded', message: 'system resolver not answering' });
  });

  it("puts the node's reason before the down cores, so the cut drops a core name", () => {
    const v = statusFromHealth({
      status: 'degraded',
      cores: [{ name: 'hysteria', running: false, provisioned: true }],
      reason: RESOLVER_DOWN_REASON,
    });
    expect(v.message).toBe('system resolver not answering; not running: hysteria');
  });
});

/**
 * E38: the stored message is 200 characters, and it used to be cut at the
 * 200th wherever that fell, mid-name. Now it is cut at a whole part or a whole
 * `, ` item, and a cut message says so with "…".
 */
describe('the status message length', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `core-with-a-long-name-${String(i + 1).padStart(2, '0')}`);

  it('cuts twelve down cores at a whole name and ends in an ellipsis', () => {
    const v = statusFromHealth({
      status: 'degraded',
      cores: twelve.map((name) => ({ name, running: false, provisioned: true })),
      reason: RESOLVER_DOWN_REASON,
    });
    const message = v.message!;
    expect(`${RESOLVER_DOWN_REASON}; not running: ${twelve.join(', ')}`.length).toBeGreaterThan(STATUS_MESSAGE_MAX);
    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_MAX);
    expect(message.endsWith('…')).toBe(true);
    expect(message.startsWith(`${RESOLVER_DOWN_REASON}; not running: `)).toBe(true);
    // Every name that made it is whole: the last one before the ellipsis too.
    const names = message.slice(`${RESOLVER_DOWN_REASON}; not running: `.length, -1).split(', ');
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(twelve).toContain(n);
  });

  it('leaves a message that fits exactly as it was', () => {
    expect(capStatusMessage(['system resolver not answering', 'not running: xray, hysteria'])).toBe(
      'system resolver not answering; not running: xray, hysteria',
    );
    const exact = 'x'.repeat(STATUS_MESSAGE_MAX);
    expect(capStatusMessage([exact])).toBe(exact);
  });

  it('drops a whole part rather than a piece of it when the first fills the room', () => {
    const first = 'r'.repeat(190); // fits alone, leaves no room for the second
    expect(capStatusMessage([first, 'a second part that does not fit'])).toBe(`${first}…`);
  });

  it('cuts inside only an item longer than the whole limit', () => {
    const out = capStatusMessage(['y'.repeat(500)]);
    expect(out).toBe(`${'y'.repeat(STATUS_MESSAGE_MAX - 1)}…`);
  });
});

/**
 * The chain process, and the one condition that keeps the rule honest.
 *
 * Phase 4 gives a node a second process. A node whose cores are fine and whose
 * chain is dead answers `ok` from the agent, because the agent's verdict is
 * about its cores and it knows nothing about a block the panel sent. Left at
 * that, a cascade entry carrying nobody would read as online.
 *
 * The trap on the other side is bigger, and it is why the flag exists: nothing
 * sends the chain block yet, so every agent on the fleet reports no chain. A
 * rule that read "no chain" as "chain down" would turn every node red on the
 * day the field shipped.
 */
describe('statusFromHealth and the chain process', () => {
  it('degrades a node whose chain was sent and is not running', () => {
    const v = statusFromHealth(
      { status: 'ok', cores: [{ name: 'xray', running: true }], chain: { running: false } },
      { chainExpected: true },
    );
    expect(v.status).toBe('degraded');
    // A key the screen can switch on, not a sentence it has to parse.
    expect(v.message).toContain('chain-process');
  });

  it('carries the engine words when the agent has them', () => {
    const v = statusFromHealth(
      {
        status: 'ok',
        cores: [{ name: 'xray', running: true }],
        chain: { running: false, error: 'sing-box: unknown field inbounds[0].sniff' },
      },
      { chainExpected: true },
    );
    expect(v.message).toContain('chain-process');
    expect(v.message).toContain('unknown field');
  });

  it('says nothing about a node that was never sent a chain', () => {
    // Every node on the fleet, on the day this shipped. The agent reports no
    // chain because it has none, and that is not a fault.
    const v = statusFromHealth(
      { status: 'ok', cores: [{ name: 'xray', running: true }] },
      { chainExpected: false },
    );
    expect(v).toEqual({ status: 'online', message: null });
  });

  it('says nothing about a chain the panel never asked for, even when it is down', () => {
    /**
     * The case the flag actually guards, and the one the other test cannot
     * reach: the node REPORTS a chain and reports it dead, and the panel never
     * sent it one.
     *
     * That happens on the way back, not on the way in: the panel is rolled
     * back, or the cascade is taken off this node, and a chain process is left
     * on the machine. It is not carrying anybody's traffic and nobody asked it
     * to, so calling the node degraded would be reporting our own leftover as
     * the operator's fault.
     */
    const v = statusFromHealth(
      {
        status: 'ok',
        cores: [{ name: 'xray', running: true }],
        chain: { running: false, error: 'stopped' },
      },
      { chainExpected: false },
    );
    expect(v).toEqual({ status: 'online', message: null });
  });

  it('does not degrade a node that was sent a chain and reports it running', () => {
    const v = statusFromHealth(
      {
        status: 'ok',
        cores: [{ name: 'xray', running: true }],
        chain: { running: true },
      },
      { chainExpected: true },
    );
    expect(v).toEqual({ status: 'online', message: null });
  });

  it('does not degrade an OLD AGENT that cannot speak about a chain at all', () => {
    // Separate from the case above, and not the same thing: there the node
    // answered "no chain", here the field does not exist in its answer. Both
    // must stay online, and they reach that through different branches.
    const v = statusFromHealth(
      { status: 'ok', cores: [{ name: 'xray', running: true }] },
      { chainExpected: true },
    );
    expect(v).toEqual({ status: 'online', message: null });
  });

  it('leaves the core verdict alone when there is no chain question', () => {
    const v = statusFromHealth({
      status: 'degraded',
      cores: [{ name: 'xray', running: false }],
    });
    expect(v.status).toBe('degraded');
    expect(v.message).toContain('xray');
  });
});