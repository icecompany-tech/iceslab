import { describe, it, expect } from 'vitest';
import { DEFAULT_FORMAT_NAMES, FORMAT_NAMES } from '@iceslab/shared';
import { SrrFormat } from '../srr/srr.schemas.js';

/**
 * The two lists that were still mirrors of the format list, checked against it.
 *
 * Neither was a copy anybody meant to keep: the settings enum was a UI
 * shortlist that had leaked into validation, and the SRR enum was eleven names
 * frozen at whatever the subscription served the day it was written. Both sat
 * in files a type check cannot connect, because on the wire they are strings.
 */
describe('the lists that narrow the format list', () => {
  it('lets a rule name every format the subscription serves', () => {
    // SRR rules only ever NARROW what /sub already does, so its list has no
    // reason to be smaller. It was: `xrayjson-array` and `amneziavpn` were
    // served every day and could not be named in a rule at all.
    expect([...SrrFormat.options].sort()).toEqual([...FORMAT_NAMES].sort());
  });

  it('keeps the bare link default to a subset of what exists', () => {
    for (const name of DEFAULT_FORMAT_NAMES) {
      expect(FORMAT_NAMES as readonly string[], `${name} is not a format at all`).toContain(name);
    }
  });

  it('refuses a default that would quietly drop servers', () => {
    // The rule the narrowing exists for, stated as a test so a later addition
    // has to think about it. A per-node file carries ONE server and needs
    // `&node=` to say which; `outline` carries Shadowsocks only, so the day an
    // xray node is added every bare link would silently stop including it.
    for (const narrow of ['wgconf', 'amneziavpn', 'outline']) {
      expect(
        DEFAULT_FORMAT_NAMES as readonly string[],
        `${narrow} cannot be a default: it does not carry the whole subscription`,
      ).not.toContain(narrow);
    }
    // And the ones that do carry it are all there, including the three paid iOS
    // formats the old five-name list left out for no stated reason.
    for (const wide of ['plain', 'clash', 'singbox', 'xrayjson', 'surge', 'quantumultx', 'loon']) {
      expect(DEFAULT_FORMAT_NAMES as readonly string[]).toContain(wide);
    }
  });
});
