/**
 * Палитра контура каскадов.
 *
 * Краски приходят из `lib/ui/tokens.ts`: одно имя на один цвет на всю панель.
 * Файл остаётся точкой импорта контура, чтобы экраны не тянули общий модуль
 * напрямую. Своих красок у контура нет ни одной.
 */
export {
  HAIRLINE,
  EDGE,
  CARD,
  WELL,
  GROUND,
  SNOW,
  MIST,
  FAINT,
  DIM,
  CYAN,
  MOSS,
  AMBER,
  RED,
  VIOLET,
} from '@/lib/ui/tokens';

export const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
