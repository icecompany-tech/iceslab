import { describe, expect, it } from 'vitest';
import { profileBindings } from '@/contours/profiles/lib/profileList';

describe('profileBindings (A-226)', () => {
  const p = { id: 'p1', bindingCount: 4 };

  it('список привязок пришёл: его счёт, отсутствие в нём это 0', () => {
    expect(profileBindings(p, new Map([['p1', 2]]), true)).toBe(2);
    expect(profileBindings(p, new Map(), true)).toBe(0);
  });

  it('список не пришёл: счёт профиля с сервера, а не «0, безопасно»', () => {
    expect(profileBindings(p, new Map(), false)).toBe(4);
  });
});
