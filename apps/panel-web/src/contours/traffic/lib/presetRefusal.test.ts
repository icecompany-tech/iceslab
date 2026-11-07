import { describe, expect, it } from 'vitest';
import { routingPresetRefusal } from '@/lib/old/routePolicies';
import { heldNames, presetRefusalWords } from '@/contours/traffic/lib/presetRefusal';

const res = (status: number, data: unknown) => ({ response: { status, data } });
const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;

describe('routingPresetRefusal (A-229)', () => {
  it('reads the entries of both rule refusals, skipping what is not a string', () => {
    expect(routingPresetRefusal(res(400, { error: 'ROUTING_PRESET_ENTRY_UNKNOWN', entries: ['ext:x:y', 3] }))).toEqual({
      code: 'ROUTING_PRESET_ENTRY_UNKNOWN',
      entries: ['ext:x:y'],
    });
    expect(routingPresetRefusal(res(400, { error: 'ROUTING_PRESET_GEO_TAG_UNKNOWN', entries: ['geosite:nope'] }))).toEqual({
      code: 'ROUTING_PRESET_GEO_TAG_UNKNOWN',
      entries: ['geosite:nope'],
    });
  });

  it('reads who holds a preset, the counts over the capped lists', () => {
    const r = routingPresetRefusal(
      res(409, {
        error: 'ROUTING_PRESET_IN_USE',
        users: [{ id: 'u1', username: 'alice' }, { id: 'u2' }],
        squads: [{ id: 's1', name: 'VIP' }],
        userCount: 120,
        squadCount: 1,
      }),
    );
    expect(r).toEqual({ code: 'ROUTING_PRESET_IN_USE', users: ['alice'], squads: ['VIP'], userCount: 120, squadCount: 1 });
  });

  it('a count missing or below its list is read from the list, never as zero', () => {
    const r = routingPresetRefusal(res(409, { error: 'ROUTING_PRESET_IN_USE', users: [{ username: 'a' }, { username: 'b' }], userCount: 1 }));
    expect(r).toMatchObject({ userCount: 2, squadCount: 0 });
  });

  it('a code under another status, an unknown code or no body is not this refusal', () => {
    expect(routingPresetRefusal(res(400, { error: 'NAME_TAKEN' }))).toBeNull();
    expect(routingPresetRefusal(res(409, { error: 'CONFLICT' }))).toBeNull();
    expect(routingPresetRefusal(res(409, { error: 'toString' }))).toBeNull();
    expect(routingPresetRefusal(res(403, null))).toBeNull();
    expect(routingPresetRefusal(null)).toBeNull();
    expect(routingPresetRefusal(new Error('net'))).toBeNull();
  });

  it('reads the three bare codes', () => {
    expect(routingPresetRefusal(res(403, { error: 'ROUTING_PRESET_BUILT_IN' }))).toEqual({ code: 'ROUTING_PRESET_BUILT_IN' });
    expect(routingPresetRefusal(res(404, { error: 'NOT_FOUND' }))).toEqual({ code: 'NOT_FOUND' });
    expect(routingPresetRefusal(res(409, { error: 'NAME_TAKEN', field: 'name' }))).toEqual({ code: 'NAME_TAKEN' });
  });
});

describe('presetRefusalWords', () => {
  it('names the holders and says how many more there are', () => {
    expect(heldNames(['a', 'b'], 2, t)).toBe('«a», «b»');
    expect(heldNames(['a', 'b', 'c'], 40, t, 2)).toBe('routes.presetHeldMore {"names":"«a», «b»","count":38}');
  });

  it('says users and squads that hold it, and only those that do', () => {
    const words = presetRefusalWords({ code: 'ROUTING_PRESET_IN_USE', users: [], squads: ['VIP'], userCount: 0, squadCount: 1 }, t);
    expect(words).toContain('routes.presetHeldSquads');
    expect(words).not.toContain('routes.presetHeldUsers');
  });

  it('gives every code its own sentence', () => {
    expect(presetRefusalWords({ code: 'ROUTING_PRESET_GEO_TAG_UNKNOWN', entries: ['geoip:zz'] }, t)).toBe(
      'routes.presetGeoTagUnknown {"entries":"geoip:zz"}',
    );
    expect(presetRefusalWords({ code: 'NAME_TAKEN' }, t)).toBe('routes.presetNameTaken');
    expect(presetRefusalWords({ code: 'NOT_FOUND' }, t)).toBe('routes.presetGone');
    expect(presetRefusalWords({ code: 'ROUTING_PRESET_BUILT_IN' }, t)).toBe('routes.presetBuiltInRefused');
  });
});
