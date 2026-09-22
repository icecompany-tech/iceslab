/**
 * Палитра контура нод.
 *
 * Краски приходят из `lib/ui/tokens.ts`: одно имя на один цвет на всю панель.
 * Файл остаётся точкой импорта контура, чтобы экраны не тянули общий модуль
 * напрямую и переезд не переписывал каждое место.
 *
 * Своих красок у контура нет ни одной: всё, что здесь стояло, уже было в общей
 * палитре под тем же именем, кроме `CYAN_HI`, который теперь `CYAN_HI` (имя со
 * «2» не говорило, чем этот цвет отличается от соседнего).
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
  CYAN_HI,
  MOSS,
  AMBER,
  RED,
  VIOLET,
} from '@/lib/ui/tokens';

export const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
