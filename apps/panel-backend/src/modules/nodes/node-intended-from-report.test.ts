import { describe, expect, it } from 'vitest';
import { intendedFromReport } from './node-intended-engines.js';
import { mapNodeToPublic } from './nodes.mapper.js';

/**
 * E42, 26.09 on ru-01: installed without --engines, then xray, hysteria and awg
 * from the node page. The cores ran and reported, and each read "taken off the
 * node's cores, yet on the machine", because the intent was written once, from
 * the installer. It follows the node's env blocks now (`declaredEngines`).
 *
 * The marker itself is the screen's (coreRemove: installed and not intended);
 * what is pinned here is the intent it reads.
 */
describe('the intended cores follow what the node declares', () => {
  // A node from a clean install without --engines: no core intended.
  const fresh = { intendedEngines: [] as string[], protocol: 'none', singboxEngine: false };

  it('three blocks, three intended cores, and the label and flag move with them', () => {
    expect(intendedFromReport(fresh, ['amneziawg', 'xray', 'hysteria'])).toEqual({
      intendedEngines: ['xray', 'hysteria', 'amneziawg'],
      protocol: 'xray',
      singboxEngine: false,
    });
  });

  it('a --remove takes the core out on the next report, whatever the binary does', () => {
    const three = { intendedEngines: ['xray', 'hysteria', 'amneziawg'], protocol: 'xray', singboxEngine: false };
    expect(intendedFromReport(three, ['xray', 'amneziawg'])).toEqual({
      intendedEngines: ['xray', 'amneziawg'],
      protocol: 'xray',
      singboxEngine: false,
    });
  });

  it('an older agent (no field) changes nothing: absence is not "no cores"', () => {
    const three = { intendedEngines: ['xray', 'hysteria'], protocol: 'xray', singboxEngine: false };
    expect(intendedFromReport(three, undefined)).toBeNull();
  });

  it('the same set, in any order, is no write', () => {
    const two = { intendedEngines: ['xray', 'singbox'], protocol: 'xray', singboxEngine: true };
    expect(intendedFromReport(two, ['singbox', 'xray'])).toBeNull();
  });

  it('an env that declares nothing is a node with no core', () => {
    const one = { intendedEngines: ['hysteria'], protocol: 'hysteria', singboxEngine: false };
    expect(intendedFromReport(one, [])).toEqual({ intendedEngines: [], protocol: 'none', singboxEngine: false });
  });

  it('what the node card reads back: every reported core intended after three blocks', () => {
    const written = intendedFromReport(fresh, ['xray', 'hysteria', 'amneziawg'])!;
    const dto = mapNodeToPublic({ ...baseRow(), ...written } as never);
    const installed = ['xray', 'hysteria', 'amneziawg'];
    // coreRemove's `dropped` is `!intended.includes(engine)`: none of the three.
    expect(installed.filter((e) => !dto.intendedEngines.includes(e as never))).toEqual([]);
  });
});

/** Just enough of a Node row for the mapper. */
function baseRow() {
  const now = new Date();
  return {
    id: 'n1',
    name: 'ru-01',
    address: 'ru-01.example',
    protocol: 'none',
    countryCode: null,
    status: 'online',
    lastStatusChange: null,
    lastStatusMessage: null,
    coreRestarts: null,
    coreVersion: null,
    lastInboundSyncAt: null,
    lastInboundSyncError: null,
    chainStatus: null,
    chainSentAt: null,
    consumptionMultiplier: 1n,
    regionId: null,
    maxUsers: null,
    domain: null,
    hardening: null,
    warpEnabled: false,
    singboxEngine: false,
    intendedEngines: [],
    policyId: null,
    dns: null,
    cores: null,
    coreVersions: null,
    geo: null,
    hysteriaTls: null,
    createdAt: now,
    updatedAt: now,
  };
}
