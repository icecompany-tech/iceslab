import { describe, expect, it } from 'vitest';
import { resolveSquadRouting } from './subscription.service.js';

// R3-a - the per-squad routing merge rule (the one design decision in R3-a).
describe('resolveSquadRouting', () => {
  it('inherits (null) when no squad overrides', () => {
    expect(resolveSquadRouting([null, null])).toBe(null);
    expect(resolveSquadRouting([])).toBe(null);
  });

  it('uses the single override', () => {
    expect(resolveSquadRouting([null, 'ru-split'])).toBe('ru-split');
    expect(resolveSquadRouting(['proxy-all'])).toBe('proxy-all');
    // H2 - cn-split resolves as a single override like any other preset.
    expect(resolveSquadRouting([null, 'cn-split'])).toBe('cn-split');
    expect(resolveSquadRouting([null, 'roscomvpn'])).toBe('roscomvpn');
  });

  it('dedupes identical overrides', () => {
    expect(resolveSquadRouting(['ru-split', 'ru-split', null])).toBe('ru-split');
    expect(resolveSquadRouting(['cn-split', 'cn-split', null])).toBe('cn-split');
    expect(resolveSquadRouting(['roscomvpn', 'roscomvpn', null])).toBe('roscomvpn');
  });

  it('falls back to null on conflicting overrides', () => {
    expect(resolveSquadRouting(['ru-split', 'proxy-all'])).toBe(null);
    // H2 - cn-split conflicting with ru-split -> inherit (null).
    expect(resolveSquadRouting(['cn-split', 'ru-split'])).toBe(null);
    expect(resolveSquadRouting(['roscomvpn', 'proxy-all'])).toBe(null);
  });

  it('ignores invalid/garbage preset values', () => {
    expect(resolveSquadRouting(['garbage', 'ru-split'])).toBe('ru-split');
    expect(resolveSquadRouting(['garbage', 'also-bad'])).toBe(null);
  });
});

// R3 - the effective-preset precedence chain resolved in subscription.routes.ts.
// Mirrors the exact `??` expression there:
//   query.routing ?? userRoutingPreset ?? squadRoutingPreset ?? settings.routingPreset
// Kept as a pure expression test so the precedence ordering is pinned even
// though the resolution itself lives inline in the route handler.
describe('routing-preset precedence (R1a + R3-a + R3)', () => {
  type Preset = 'proxy-all' | 'ru-split' | 'cn-split' | 'roscomvpn';
  function resolve(
    query: Preset | undefined,
    user: Preset | null,
    squad: Preset | null,
    global: Preset,
  ): Preset {
    return query ?? user ?? squad ?? global;
  }

  it('?routing= query wins over everything', () => {
    expect(resolve('proxy-all', 'ru-split', 'ru-split', 'ru-split')).toBe('proxy-all');
  });

  it('per-user override wins over squad and global', () => {
    expect(resolve(undefined, 'ru-split', 'proxy-all', 'proxy-all')).toBe('ru-split');
  });

  it('squad override wins over global when user has no override', () => {
    expect(resolve(undefined, null, 'ru-split', 'proxy-all')).toBe('ru-split');
  });

  it('falls back to the global setting when neither user nor squad set', () => {
    expect(resolve(undefined, null, null, 'ru-split')).toBe('ru-split');
  });

  it('defaults to proxy-all all the way down', () => {
    expect(resolve(undefined, null, null, 'proxy-all')).toBe('proxy-all');
  });
});
