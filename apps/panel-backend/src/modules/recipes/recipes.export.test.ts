import { describe, expect, it } from 'vitest';
import { PROTOCOL_NAMES } from '@iceslab/shared';
import { EXPORTABLE_FIELDS, profileToRecipe, recipeAllowlist, recipeIdOf } from './recipes.export.js';
import { RecipeSchema } from './recipes.schemas.js';

/**
 * The export reads form fields off a profile by a table of its own. The table
 * is held to the allowlist here, so the day the registry starts setting a field
 * the export cannot read, this goes red instead of the export dropping it.
 */
describe('the export table covers the allowlist', () => {
  it('every field the registry sets on a protocol the panel serves has a reader', () => {
    const { fields } = recipeAllowlist();
    const missing: string[] = [];
    for (const [protocol, set] of fields) {
      if (!(PROTOCOL_NAMES as readonly string[]).includes(protocol)) continue; // telegramweb: no profile yet
      for (const f of set) if (!EXPORTABLE_FIELDS.has(f)) missing.push(`${protocol}.${f}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('profileToRecipe', () => {
  const base = { id: '0f0e0d0c-0000-4000-8000-000000000000', description: null, engine: null };

  it('hysteria with salamander: the password goes out as a draw, the rest as values', () => {
    const r = profileToRecipe({
      ...base,
      name: 'HY2',
      protocol: 'hysteria',
      config: { obfsPassword: 'secret-pass', masqueradeUrl: 'https://www.bing.com', brutalUpMbps: 100, portHoppingStart: 20000 },
    });
    expect(r.apply).toEqual({ hyMasqueradeUrl: 'https://www.bing.com', hyBrutalUp: 100, hyPortHopStart: 20000 });
    expect(r.randomize).toEqual([{ field: 'hyObfsPassword', kind: 'password16' }]);
    expect(JSON.stringify(r)).not.toContain('secret-pass');
    expect(RecipeSchema.safeParse(r).success).toBe(true);
  });

  it('engine from the profile: tuic is sing-box, xray pinned to sing-box too; no subprotocol off xray', () => {
    const tuic = profileToRecipe({ ...base, name: 'T', protocol: 'tuic', config: { congestionControl: 'bbr' } });
    expect(tuic).toMatchObject({ engine: 'singbox', protocol: 'tuic', apply: { tuicCongestion: 'bbr' } });
    expect(tuic.subprotocol).toBeUndefined();
    const sb = profileToRecipe({ ...base, name: 'V', protocol: 'xray', engine: 'singbox', config: { subprotocol: 'trojan' } });
    expect(sb).toMatchObject({ engine: 'singbox', subprotocol: 'trojan', apply: { xraySubprotocol: 'trojan' } });
    expect(RecipeSchema.safeParse(sb).success).toBe(true);
  });

  it('AmneziaWG: its numbers as values, the four headers as draws, never the server key', () => {
    const r = profileToRecipe({
      ...base,
      name: 'AWG',
      protocol: 'amneziawg',
      config: { subnet: '10.66.66.0/24', serverPrivateKey: 'PRIV', obfuscation: { jc: 4, jmin: 64, jmax: 128, s1: 32, h1: 1234567 } },
    });
    expect(r.apply).toMatchObject({ awgPreset: 'custom', awgSubnet: '10.66.66.0/24', awgJc: 4, awgS1: 32 });
    expect(r.randomize).toEqual([{ field: 'awgH1', kind: 'awgHeader' }]);
    expect(JSON.stringify(r)).not.toContain('PRIV');
  });

  it('an id the registry takes, whatever the name', () => {
    expect(recipeIdOf('My VLESS gRPC (RU)', base.id)).toBe('my-vless-grpc-ru');
    expect(recipeIdOf('Профиль', base.id)).toBe('profile-0f0e0d0c');
  });
});
