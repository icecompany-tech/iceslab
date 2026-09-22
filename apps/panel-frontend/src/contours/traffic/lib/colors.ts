/**
 * Палитра контура правил.
 *
 * Общие краски приходят из `lib/ui/tokens.ts`: одно имя на один цвет на всю
 * панель. Здесь остаётся только то, чего нет больше нигде.
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
  MOSS,
  AMBER,
  RED,
  VIOLET,
} from '@/lib/ui/tokens';

/** The warm ground and muted ink a shadowed row wears. */
export const SHADOW_BG = '#1A1512';
export const SHADOW_INK = '#6E6257';
export const SHADOW_NOTE = '#C08A5A';

export const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/** Edges a device rule wears: a normal row, the always-on default, a warning. */
export const RULE_EDGE = '#4E8FB8';
export const DEFAULT_EDGE = '#4ADE80';
/** Та же краска, что у `SHADOW_BG`, под именем предупреждения. Оставлена как
 *  есть при сведении палитры: по одному месту на имя, сводить нечего. */
export const WARN_BG = '#1A1512';
export const WARN_EDGE = '#3A2320';
