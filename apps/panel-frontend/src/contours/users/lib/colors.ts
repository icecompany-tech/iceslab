/**
 * Палитра контура юзеров.
 *
 * Краски больше не объявляются здесь: они приходят из `lib/ui/tokens.ts`, где
 * одно имя значит один цвет на всю панель. Файл остаётся точкой импорта, чтобы
 * тридцать пять мест этого контура не переписывались ради переезда, и держит
 * то, что действительно только здесь.
 */
export {
  HAIRLINE,
  CARD,
  WELL,
  GROUND,
  ROW,
  EDGE,
  SNOW,
  MIST,
  FAINT,
  DIM,
  CYAN,
  MOSS,
  RED,
  AMBER,
  VIOLET,
} from '@/lib/ui/tokens';

export const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * Две краски, которые есть только на этом экране.
 *
 * Они не украшение: элементы плана нарочно тише поля имени над ними (WELL на
 * FIELD_EDGE против GROUND на EDGE), и повтор громкой пары заставлял два ряда
 * спорить друг с другом. В общие токены не идут: одно место на имя, сводить
 * нечего.
 */
export const FIELD_EDGE = '#16243F';
export const VIOLET_HI = '#C0AAF6';
