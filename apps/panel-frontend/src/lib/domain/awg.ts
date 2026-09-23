/**
 * Поколение протокола AmneziaWG на ноде (фаза 7, решение владельца 23.09).
 *
 * AWG 3.x с 1.x несовместим: клиент поколения 3.1 это AmneziaVPN 5.0.1.5 и
 * новее, конфиги 1.x ему не подходят, а роутеры 3.1 не умеют вовсе. Поэтому
 * версия это свойство НОДЫ, которое выбирает оператор, а экран говорит, какой
 * клиент к ней нужен.
 *
 * Три значения, как у всех полей контракта:
 *   `undefined`  сервер поля ещё не отдаёт: экран молчит про версию целиком;
 *   `null`       сервер отдаёт, версия не задана: читается как 1, так живут все
 *                ноды, поставленные до фазы 7;
 *   `1 | 3`      выбор оператора.
 */
export type AwgProtocol = 1 | 3;

export const AWG_PROTOCOLS: AwgProtocol[] = [1, 3];

/** Как поколение называется словами. «3.1», а не «3»: клиенты и роутеры
 *  различают именно эту версию протокола, и оператор ищет её по этому имени. */
export function awgLabel(g: AwgProtocol): string {
  return g === 3 ? '3.1' : '1.x';
}

/** Что задано, с null, прочитанным как 1. `undefined` остаётся молчанием. */
export function awgIntended(value: AwgProtocol | null | undefined): AwgProtocol | undefined {
  if (value === undefined) return undefined;
  return value ?? 1;
}

/**
 * Какой клиент нужен ноде этой версии. Подпись у селектора в форме ноды.
 *
 * `null` читается как 1: это поведение сервера для нод до фазы 7, и подсказка
 * обязана говорить о том, что реально уйдёт клиенту. `undefined` это «сервер
 * поля не знает», и тогда подсказки нет, потому что нет и селектора.
 */
export function awgClientHint(value: AwgProtocol | null | undefined): 'awgHint1' | 'awgHint3' | null {
  const g = awgIntended(value);
  if (g === undefined) return null;
  return g === 3 ? 'awgHint3' : 'awgHint1';
}

/**
 * Как AWG исполняется на ноде (фаза 7): 1 на модуле ядра, 3 отдельным
 * процессом на своём порту. Три значения, как у всех полей контракта:
 * `undefined` это «сервер поля не отдаёт».
 */
export type AwgRuntime = 'kernel' | 'userspace';

/**
 * Показывать ли серую строку «версия 3 живёт отдельным процессом...».
 *
 * Только у версии 3 и только когда сервер отдаёт `awgRuntime`: до фазы 7 мы не
 * знаем, как нода её исполняет, и утверждать про отдельный процесс и порт было
 * бы рано.
 */
export function awgRuntimeNoteShown(
  value: AwgProtocol | null | undefined,
  runtime: AwgRuntime | null | undefined,
): boolean {
  return awgIntended(value) === 3 && runtime !== undefined;
}

/**
 * Показывать ли выбор поколения AWG в форме ноды.
 *
 * Только когда сервер поле знает, иначе селектор обещал бы выбор, который
 * сервер отвергнет. И только там, где AWG на ноде есть: протокол ноды это
 * amneziawg, ИЛИ ядро amneziawg на ней уже занято профилем. Второе условие не
 * лишнее: агент регистрирует адаптер на каждый протокол, и AWG-профиль может
 * жить на ноде с другим основным протоколом. Незанятое ядро выбора не просит.
 */
export function awgSelectorShown(
  known: boolean,
  protocol: string,
  cores: { name: string; provisioned?: boolean }[] | null | undefined,
): boolean {
  if (!known) return false;
  if (protocol === 'amneziawg') return true;
  return (cores ?? []).some((c) => c.name === 'amneziawg' && c.provisioned === true);
}

/**
 * Кусок пейлоада ноды с поколением AWG, или пустой объект.
 *
 * ⚠ Ключ уходит только при двух условиях сразу: сервер поле ЗНАЕТ, и оператор
 * его ПРАВИЛ. Первое страхует от отказа сохранения до контракта (строгая схема
 * отвергает незнакомый ключ), второе это то же правило, что везде с
 * 2026-07-31: не слать того, чего экран не правил.
 */
export function awgPayload(
  known: boolean,
  touched: boolean,
  value: AwgProtocol | null,
): { awgProtocol?: AwgProtocol | null } {
  return known && touched ? { awgProtocol: value } : {};
}

/**
 * Что ядро amneziawg сообщило о себе (фаза 7): версию протокола С ИНТЕРФЕЙСА и
 * то, как оно исполняется.
 *
 * Факт берётся из отчёта ядра, а не выводится из строки версии модуля: версия
 * модуля это про установленный файл, а не про то, чем интерфейс говорит с
 * клиентом, и выводить одно из другого значило бы завести второй источник
 * правды, который однажды разойдётся с первым.
 *
 * ⚠ Контракта у этих полей ещё нет, поэтому объект читается с проверкой, а не
 * по типу: пока поля не приехали, ответ `undefined`, и строка молчит. Имена
 * полей (`awgProtocol`, `runtime`) взяты из задания ARCH 23.09; если BACK
 * назовёт иначе, правка ровно здесь.
 */
export interface CoreAwgReport {
  reported: AwgProtocol | null | undefined;
  runtime: AwgRuntime | null | undefined;
}

export function readCoreAwg(core: object): CoreAwgReport {
  const c = core as Record<string, unknown>;
  const p = c.awgProtocol;
  const r = c.runtime;
  return {
    reported: p === 1 || p === 3 ? p : p === null ? null : undefined,
    runtime: r === 'kernel' || r === 'userspace' ? r : r === null ? null : undefined,
  };
}

/**
 * Строка у ядра amneziawg в секции «Ядра»: намерение против факта.
 *
 * `intended` это выбор оператора (`awgProtocol` ноды), `reported` это версия
 * протокола, с которой поднят интерфейс, `runtime` это модуль ядра или
 * отдельный процесс. Расхождение намерения с фактом это повод для янтарной
 * строки: клиенты, которым выдан конфиг одного поколения, к интерфейсу другого
 * не подключатся.
 *
 * `null` на выходе это «сказать нечего»: сервер не отдаёт намерение. Все три
 * поля до контракта `undefined`, и тогда строка молчит целиком.
 */
export interface AwgVersionFacts {
  intended: AwgProtocol;
  /** `null` = ядро версию не сообщило. */
  reported: AwgProtocol | null;
  /** `null` = ядро не сообщило, как исполняется. */
  runtime: AwgRuntime | null;
  mismatch: boolean;
}

export function awgVersionFacts(
  value: AwgProtocol | null | undefined,
  core: CoreAwgReport,
): AwgVersionFacts | null {
  const intended = awgIntended(value);
  if (intended === undefined) return null;
  const reported = core.reported ?? null;
  return {
    intended,
    reported,
    runtime: core.runtime ?? null,
    mismatch: reported !== null && reported !== intended,
  };
}
