import { describe, expect, it } from 'vitest';
import { dialCopy } from '@/contours/users/lib/dialCopy';

describe('dialCopy', () => {
  it('1. AmneziaWG без строки-ссылки: кнопка выключена, причина в подсказке', () => {
    expect(dialCopy('', 'amneziawg')).toEqual({
      enabled: false,
      labelKey: 'userDrawer.copy',
      titleKey: 'userDrawer.copyNoLink',
    });
    // Пробелы и отсутствие поля это та же пустота, а не ссылка.
    expect(dialCopy('   ', 'amneziawg').enabled).toBe(false);
    expect(dialCopy(undefined, 'amneziawg').enabled).toBe(false);
  });

  it('2. AmneziaWG со ссылкой на wgconf (после коммита BACK): «Копировать ссылку»', () => {
    expect(dialCopy('https://panel.example/sub/tok/wgconf/n1', 'amneziawg')).toEqual({
      enabled: true,
      labelKey: 'userDrawer.copyLink',
      titleKey: 'userDrawer.copyLinkHint',
    });
  });

  it('3. обычная строка для клиента: «Копировать»', () => {
    expect(dialCopy('vless://uuid@host:443?security=reality', 'xray')).toEqual({
      enabled: true,
      labelKey: 'userDrawer.copy',
      titleKey: 'userDrawer.copyUri',
    });
  });

  it('4. пустой uri у любого протокола это тоже выключенная кнопка', () => {
    expect(dialCopy('', 'xray').enabled).toBe(false);
  });
});
