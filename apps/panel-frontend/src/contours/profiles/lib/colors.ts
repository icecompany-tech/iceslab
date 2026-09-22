/**
 * Палитра контура профилей.
 *
 * Общие краски приходят из `lib/ui/tokens.ts`: одно имя на один цвет на всю
 * панель. Здесь остаются две, которых нет больше нигде.
 *
 * ⚠ Сюда НЕ входят два файла и это намеренно. `TelegramPreview` рисует чужой
 * интерфейс, и совпадения его красок с нашими случайны. `EnginePicker` и
 * `protocolTiles` держат фирменные цвета протоколов: это чужие бренды, а не
 * палитра панели.
 */
export {
  HAIRLINE,
  EDGE,
  CARD,
  WELL,
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

/** Две краски строк подписки на карточке профиля, обе только здесь. */
export const PURPLE = '#C78BFA';
export const PINK = '#F5A3B8';
