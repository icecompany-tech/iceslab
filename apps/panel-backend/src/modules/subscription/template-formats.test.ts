import { describe, it, expect } from 'vitest';
import { FORMAT_NAMES, TEMPLATE_FORMATS, TEMPLATE_TYPES } from '@iceslab/shared';

/**
 * The template types against the formats they frame.
 *
 * A template is a frame the operator writes; the format is what `/sub` answers
 * with while that template is in force. The frontend builds the editor from
 * this table, so a type pointing at a format this build cannot serve would be a
 * screen offering a template nobody can use, discovered by the operator.
 */
describe('the template formats', () => {
  it('gives every type a format', () => {
    expect(Object.keys(TEMPLATE_FORMATS).sort()).toEqual([...TEMPLATE_TYPES].sort());
  });

  it('frames only formats this build actually serves', () => {
    for (const type of TEMPLATE_TYPES) {
      expect(
        FORMAT_NAMES as readonly string[],
        `template type ${type} frames ${TEMPLATE_FORMATS[type]}, which /sub does not serve`,
      ).toContain(TEMPLATE_FORMATS[type]);
    }
  });

  it('lets several types frame one format, and says which', () => {
    // ⚠ Not an accident and not a placeholder to be "cleaned up": the plan
    // names a new YAML dialect for `stash` and a legacy one for `clash`, and
    // neither is a `?format=` yet. Both are YAML the clash builder already
    // produces, so both frame `clash` until those dialects ship. The day they
    // do, this expectation is what has to be edited, which is the point of
    // writing it down as one.
    expect(TEMPLATE_FORMATS.mihomo).toBe('clash');
    expect(TEMPLATE_FORMATS.stash).toBe('clash');
    expect(TEMPLATE_FORMATS.clash).toBe('clash');
    // The three that map one to one today.
    expect(TEMPLATE_FORMATS.singbox).toBe('singbox');
    expect(TEMPLATE_FORMATS['xray-json']).toBe('xrayjson');
    expect(TEMPLATE_FORMATS['xray-json-array']).toBe('xrayjson-array');
  });

  it('frames nothing that carries a single node or a single protocol', () => {
    // A template exists to arrange MANY servers: groups, rules, a selector. The
    // per-node files (wgconf, amneziavpn) and the protocol-narrow ones
    // (outline) have nothing for a frame to arrange, and a type pointing at one
    // would be an editor for a file with one line in it.
    const framed = Object.values(TEMPLATE_FORMATS);
    for (const narrow of ['wgconf', 'amneziavpn', 'outline', 'plain']) {
      expect(framed, `${narrow} cannot be framed by a template`).not.toContain(narrow);
    }
  });
});
