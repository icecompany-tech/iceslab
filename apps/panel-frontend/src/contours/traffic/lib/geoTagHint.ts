import { GEO_BUILTIN_NAMES, GEO_SET_NAME } from '@iceslab/shared';
import type { GeoSetKind } from '@/lib/domain/geoSets';

/** Имя набора внутри ссылки: та же форма, что у контракта, без якорей. */
const NAME = GEO_SET_NAME.source.replace(/^\^/, '').replace(/\$$/, '');
const BUILTIN = Object.values(GEO_BUILTIN_NAMES).join('|');
const BUILTIN_TOKEN = new RegExp(`^(${BUILTIN}):([^\\s:]*)$`, 'i');
const EXT_TOKEN = new RegExp(`^ext:(${NAME}):([^\\s:]*)$`);
const EXT_PREFIX = new RegExp(`^ext:(${NAME}):`);

/**
 * Подсказка тегов гео-набора в строке правила (Ф9.5, geo-contract §6).
 *
 * Ссылки в правилах: `geosite:<tag>` и `geoip:<tag>` это встроенные наборы
 * (у них имена `geosite` и `geoip`), `ext:<name>:<tag>` свой набор. Подсказка
 * смотрит на ПОСЛЕДНИЙ токен строки, тот, что сейчас набирают; разделители те
 * же, что у разбора строки правила: пробел, запятая, средняя точка, перевод
 * строки.
 */
export interface GeoTagQuery {
  /** Имя набора, чьи теги спрашивать. */
  setName: string;
  /** Что стоит перед тегом: `geosite:`, `geoip:` или `ext:<name>:`. */
  prefix: string;
  /** Набранная часть тега, может быть пустой. */
  q: string;
  /** С какого знака строки начинается токен. */
  start: number;
}

export function geoTagQuery(line: string): GeoTagQuery | null {
  const m = /(^|[\s,·])([^\s,·]*)$/.exec(line);
  if (!m) return null;
  const token = m[2] ?? '';
  const start = line.length - token.length;
  const builtin = BUILTIN_TOKEN.exec(token);
  if (builtin) {
    const setName = builtin[1]!.toLowerCase();
    return { setName, prefix: `${setName}:`, q: builtin[2] ?? '', start };
  }
  // `ext:` строго в нижнем регистре, как у xray; имя набора по форме сервера.
  const ext = EXT_TOKEN.exec(token);
  if (ext) return { setName: ext[1]!, prefix: `ext:${ext[1]}:`, q: ext[2] ?? '', start };
  return null;
}

/** Строка с выбранным тегом на месте набираемого токена. */
export function withGeoTag(line: string, query: GeoTagQuery, tag: string): string {
  return line.slice(0, query.start) + query.prefix + tag;
}

/**
 * Вид набора за токеном `ext:<name>:<tag>`, если набор известен. Нужен разбору
 * строки правила ноды: адресный набор (geoip) уходит в список адресов, иначе
 * сервер отказал бы 400 GEO_REF_KIND. Незнакомое имя это не факт: `null`, и
 * токен идёт как раньше (сервер скажет GEO_REF_UNKNOWN словами).
 */
export function extTokenKind(token: string, kinds: ReadonlyMap<string, GeoSetKind>): GeoSetKind | null {
  const m = EXT_PREFIX.exec(token.trim());
  return m ? (kinds.get(m[1]!) ?? null) : null;
}
