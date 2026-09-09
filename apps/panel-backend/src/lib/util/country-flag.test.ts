import { describe, expect, it } from 'vitest';
import { cascadeProfileLabel, countryFlag, subscriptionServerName } from './country-flag.js';

describe('countryFlag', () => {
  it('builds the emoji from regional indicators', () => {
    expect(countryFlag('RU')).toBe('🇷🇺');
    expect(countryFlag('SE')).toBe('🇸🇪');
    expect(countryFlag('NL')).toBe('🇳🇱');
  });

  it('accepts lowercase and surrounding space', () => {
    expect(countryFlag(' de ')).toBe('🇩🇪');
  });

  it('returns nothing rather than mojibake for a missing or bogus code', () => {
    for (const bad of [null, undefined, '', 'X', 'XYZ', '12', 'R1']) {
      expect(countryFlag(bad)).toBe('');
    }
  });
});

describe('subscriptionServerName', () => {
  it("uses the host's own name, not the node's", () => {
    // The regression: clients showed "ru-test1 · Ru-xhttp-reality", pairing an
    // internal node name with the label the operator actually wrote.
    expect(
      subscriptionServerName({
        hostRemark: 'Ru-xhttp-reality',
        nodeName: 'ru-test1',
        countryCode: 'RU',
      }),
    ).toBe('🇷🇺 Ru-xhttp-reality');
  });

  it('falls back to the node name for the auto-created Default host', () => {
    expect(
      subscriptionServerName({ hostRemark: 'Default', nodeName: 'se-test1', countryCode: 'SE' }),
    ).toBe('🇸🇪 se-test1');
    expect(
      subscriptionServerName({ hostRemark: '', nodeName: 'se-test1', countryCode: 'SE' }),
    ).toBe('🇸🇪 se-test1');
  });

  it('omits the flag when the node has no country, without a stray space', () => {
    expect(subscriptionServerName({ hostRemark: 'Direct', nodeName: 'n1', countryCode: null })).toBe(
      'Direct',
    );
  });

  it('leads with the country for a cascade way out, not with our machine names', () => {
    // The regression: clients read "<exit node> · <entry host>", two internal
    // names glued together. Neither is a thing the person choosing a country
    // has an opinion about. Any code works, these two are arbitrary.
    // The arrow replaced a dot on 2026-08-15: with a cascade named after its
    // ENTRY (the usual habit), "ru · NL" reads as "ru via NL", which is
    // backwards, and it was read that way the first time an operator saw it.
    expect(cascadeProfileLabel('cascade', 'DE', 'exit-01')).toBe('🇩🇪 cascade → DE');
    expect(cascadeProfileLabel('cascade', 'fr', 'exit-02')).toBe('🇫🇷 cascade → FR');
  });

  it('falls back to the exit node name when the node has no country', () => {
    // Without a country there is nothing else telling two ways out apart.
    expect(cascadeProfileLabel('cascade', null, 'exit-01')).toBe('cascade → exit-01');
  });

  it('puts the flag first so it survives truncation in a client list', () => {
    const name = subscriptionServerName({
      hostRemark: 'A very long host name that a narrow client will cut off',
      nodeName: 'n1',
      countryCode: 'NL',
    });
    expect(name.startsWith('🇳🇱 ')).toBe(true);
  });
});
