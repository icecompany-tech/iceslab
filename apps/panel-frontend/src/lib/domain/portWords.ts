import type { PortOwner, PortTakenCode } from '@/lib/domain/portCheck';

/**
 * Слова про порт: кто его держит и почему сохранить не вышло.
 *
 * Отдельно от разметки, потому что это единственное место, где решается, что
 * человек ПРОЧТЁТ, а такие места должны проверяться тестом. Компонент отсюда
 * берёт готовую строку и занимается только цветом и точкой.
 *
 * `t` приходит параметром, а не импортом: так функции остаются чистыми, и тест
 * подставляет настоящий словарь локали, а не заглушку, которая согласится с
 * любой опечаткой.
 */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** Одна фраза про одного держателя порта. Общая для подсказки и для отказа. */
export function conflictSentence(c: PortOwner, t: Translate): string {
  const common = { port: c.port, transport: c.transport };
  if (c.kind === 'profile') return t('portCheck.busyProfile', { ...common, name: c.name });
  if (c.kind === 'cascade') return t('portCheck.busyCascade', { ...common, name: c.name });
  return t('portCheck.busyCore', { ...common, owner: ownerWord(c.ownerKey, t) });
}

/** Кто держит порт, одним оборотом: имя профиля, имя каскада или служба ядра. */
export function holderWord(c: PortOwner, t: Translate): string {
  if (c.kind === 'profile' || c.kind === 'cascade') return c.name;
  return ownerWord(c.ownerKey, t);
}

/**
 * Имя служебного слушателя человеческими словами.
 *
 * Неизвестный ключ показывается КАК ЕСТЬ. Ядро может завести службу раньше, чем
 * панель узнает её имя, и подставить «неизвестная служба» значило бы стереть
 * единственную зацепку, по которой оператор найдёт её на машине.
 */
export function ownerWord(key: string, t: Translate): string {
  const word = t(`portCheck.owner.${key}`);
  return word === `portCheck.owner.${key}` ? key : word;
}

/**
 * Отказ сохранения, когда список держателей не приехал.
 *
 * Код говорит, ЧТО случилось, и этого хватает, чтобы не молчать: фраза без
 * подробностей всё равно отправляет человека менять порт.
 */
export function refusalSentence(code: PortTakenCode, t: Translate): string {
  return t(`portCheck.refused.${code}`);
}
