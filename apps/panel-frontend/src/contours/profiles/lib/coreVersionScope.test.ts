import { describe, expect, it } from 'vitest';
import { componentsOfEngine } from '@iceslab/shared';
import { coreVersionScope } from '@/contours/profiles/lib/coreVersionScope';
import { profiles as ru } from '@/i18n/locales/ru/profiles';

describe('coreVersionScope: what the version strip says per tile', () => {
  it('WEB: the manifest has no component, the strip says why and counts no fleet', () => {
    expect(componentsOfEngine('telegramweb')).toEqual([]);
    expect(coreVersionScope('telegramweb')).toEqual({ kind: 'unbuilt', textKey: 'profiles.engine.webNoCore' });
    expect(ru.profiles.engine.webNoCore).toBe(
      'Ядро для WEB (tproxy-server, MTProxy, Caddy) панель ещё не ставит и не пинит; появится с фазой WEB.',
    );
  });

  it('an engine with components: the components, AmneziaWG two of them', () => {
    expect(coreVersionScope('xray')).toEqual({ kind: 'components', components: ['xray'] });
    expect(coreVersionScope('amneziawg')).toEqual({
      kind: 'components',
      components: ['amneziawg-module', 'amneziawg-tools'],
    });
  });
});
