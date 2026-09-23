/**
 * Что делает кнопка копирования у строки в карточке «Что может набрать».
 *
 * У AmneziaWG строки-ссылки нет: конфиг забирается файлом на странице подписки,
 * и сервер отдаёт у таких эндпоинтов пустой `uri`. Кнопка, которая копирует
 * пустоту, выглядит рабочей и молча ничего не делает (поймано владельцем на
 * живой панели 23.09). Поэтому пустой `uri` это кнопка выключенная и с причиной
 * в подсказке.
 *
 * Когда BACK заполнит `uri` у AmneziaWG ссылкой на wgconf одной ноды, та же
 * фабрика даст рабочую кнопку с подписью «Копировать ссылку»: копируется не
 * строка для клиента, а адрес файла, и подпись это различает.
 */
export interface DialCopy {
  enabled: boolean;
  /** Ключ подписи кнопки. */
  labelKey: 'userDrawer.copy' | 'userDrawer.copyLink';
  /** Ключ подсказки: что копируется, или почему нечего. */
  titleKey: 'userDrawer.copyUri' | 'userDrawer.copyLinkHint' | 'userDrawer.copyNoLink';
}

export function dialCopy(uri: string | null | undefined, protocol: string): DialCopy {
  if (!uri || uri.trim() === '') {
    return { enabled: false, labelKey: 'userDrawer.copy', titleKey: 'userDrawer.copyNoLink' };
  }
  if (protocol === 'amneziawg') {
    return { enabled: true, labelKey: 'userDrawer.copyLink', titleKey: 'userDrawer.copyLinkHint' };
  }
  return { enabled: true, labelKey: 'userDrawer.copy', titleKey: 'userDrawer.copyUri' };
}
