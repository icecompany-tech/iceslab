import { describe, expect, it } from 'vitest';
import { blankPreset, presetWrite } from '@/contours/traffic/lib/devicePresets';

const rules = [{ match: ['geoip:ru'], action: 'direct' as const, note: '' }];
const stored = { id: '7f1c0000-0000-4000-8000-000000000001', name: 'Мой', builtIn: false, rules: [] };

describe('presetWrite (A-229)', () => {
  it('a new preset goes whole, under its typed name', () => {
    expect(presetWrite({ ...blankPreset(), name: 'из файла' }, '  Сплит ', rules, [])).toEqual({
      kind: 'create',
      input: { name: 'Сплит', rules },
    });
  });

  it('an existing one sends only what changed; nothing changed is null', () => {
    expect(presetWrite(stored, 'Мой', [], [])).toBeNull();
    expect(presetWrite(stored, 'Новый', [], [])).toEqual({ kind: 'update', input: { name: 'Новый' } });
    expect(presetWrite(stored, 'Мой', rules, [])).toEqual({ kind: 'update', input: { rules } });
    // An emptied name is not a rename.
    expect(presetWrite(stored, '  ', [], [])).toBeNull();
  });
});
