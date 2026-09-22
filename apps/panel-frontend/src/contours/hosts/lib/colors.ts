/**
 * Палитра контура хостов.
 *
 * Контур жил без общего модуля вовсе: три экрана держали по своей копии
 * палитры. Общие краски теперь приходят из `lib/ui/tokens.ts`, одно имя на один
 * цвет на всю панель, а здесь остаются две, которых нет больше нигде.
 */
export {
  HAIRLINE,
  EDGE,
  CARD,
  WELL,
  ROW,
  SNOW,
  MIST,
  FAINT,
  DIM,
  CYAN,
  CYAN_HI,
  MOSS,
  AMBER,
  RED,
  VIOLET,
} from '@/lib/ui/tokens';

/** Дорожка, по которой едет шкала свежести хоста. */
export const TRACK = '#16202E';
/** Засечка «сейчас» на той же шкале. */
export const CURRENT = '#4E8FB8';
