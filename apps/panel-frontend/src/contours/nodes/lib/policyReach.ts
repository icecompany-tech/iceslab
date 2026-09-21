import type { NodeCore } from '@/lib/domain/nodes';

/**
 * Достанет ли политика уровня ноды до этой машины.
 *
 * Применять правила это работа ЯДРА, а не ноды: сегодня из девяти адаптеров
 * агента `ApplyPolicy` реализует ровно один. На ноде с AmneziaWG, sing-box,
 * нативной hysteria, naive, mieru или mtproto правило «заблокировать»
 * выглядит применённым и не применяется, а панель об этом молчала.
 *
 * ТРИ состояния, и третье не округление второго:
 *
 *   applies         хотя бы одно ядро рисует политику и стоит на машине.
 *   not-applicable  ядра ответили, и ни одно её не рисует.
 *   unknown         спросить было некого либо никто не ответил.
 *
 * Считается ТОЛЬКО по отчёту ноды. Не по `Node.protocol`: это ярлык «что
 * поставили основным», а не список умений, и чтение его как ограничения уже
 * дважды стоило отказов рабочим парам.
 */
export type PolicyApplicability = 'applies' | 'not-applicable' | 'unknown';

/** Почему политика не применима. Различаются РАЗНЫМИ действиями оператора:
 *  в первом случае ждать цепь, во втором поставить бинарник. */
export type PolicyGap = 'no-router' | 'router-not-installed';

export interface PolicyReachFacts {
  state: PolicyApplicability;
  /** Ядро, которое политику рисует. Есть только при `applies`, и только из
   *  отчёта: имя и версия нужны, чтобы сказать оператору, КТО её применяет. */
  router?: { name: string; version?: string };
  /** Есть только при `not-applicable`. */
  gap?: PolicyGap;
}

/**
 * Рисует ли ЭТО ядро политику на самом деле.
 *
 * Два факта из разных источников, и агент их не сводит: `rendersPolicy` это
 * свойство АДАПТЕРА (умеет ли он в принципе), `installed` это факт МАШИНЫ
 * (лежит ли бинарник). Ядро, которое умеет, но не установлено, политику не
 * применяет, и сказать про такую ноду «применяется» значит соврать.
 *
 * `installed !== false`, а не `=== true`: отсутствие поля это «агент старше
 * поля», и читать его как «не установлено» значило бы погасить политику на
 * всём сегодняшнем флоте.
 */
function draws(c: NodeCore): boolean {
  return c.rendersPolicy === true && c.installed !== false;
}

/**
 * Кого на этой ноде политика достанет, по именам ядер.
 *
 * Считается ТОЛЬКО по занятым ядрам. Ядро с `provisioned === false` не
 * обслуживает никого: инбаунда у него нет, подключений через него нет, и
 * назвать его «ходящим мимо политики» значит придумать дыру, в которую некому
 * пролезть. На стенде это выглядело так: нода перечисляла hysteria,
 * shadowsocks и amneziawg как обходящих правила, притом что все три стояли
 * пустыми.
 *
 * `provisioned !== false`, а не `=== true`: отсутствие поля это «агент старше
 * поля», и читать молчание как «не настроено» значило бы вычеркнуть из охвата
 * весь сегодняшний флот.
 *
 * Пустой результат по всем трём спискам означает, что говорить не о чем:
 * занятых ядер на ноде нет вовсе.
 */
export interface PolicyCoverage {
  /** Ядра, которые политику применяют. */
  applied: string[];
  /** Ядра, которые её НЕ применяют, то есть настоящая дыра в охвате. */
  missing: string[];
  /** Ядра, которые про это молчат. Не «нет» и не «да». */
  unknown: string[];
}

export function policyCoverage(cores: NodeCore[] | null | undefined): PolicyCoverage {
  const busy = (cores ?? []).filter((c) => c.provisioned !== false);
  return {
    applied: busy.filter((c) => c.rendersPolicy === true).map(coreLabel),
    missing: busy.filter((c) => c.rendersPolicy === false).map(coreLabel),
    unknown: busy.filter((c) => c.rendersPolicy === undefined).map(coreLabel),
  };
}

/** Имя ядра для перечисления. Движок называется только когда он не родной для
 *  протокола: иначе строка «hysteria (hysteria)» повторяет сама себя. */
export function coreLabel(c: NodeCore): string {
  return c.engine && c.engine !== c.name ? `${c.name} (${c.engine})` : c.name;
}

/**
 * Что показать про политику в СПИСКЕ нод, где место есть только на метку.
 *
 * `null` означает «молчать», и таких случая два, разных по смыслу: политику
 * этой ноде не назначали, и назначенная политика применяется. Первое не повод
 * ничего говорить, второе тоже: зелёная метка на каждой здоровой ноде это шум,
 * из-за которого перестают замечать две другие.
 *
 * Отдельной функцией, а не условием в разметке, потому что путаница «нет
 * политики» и «политика не работает» это ровно та ошибка, которую метка
 * показала бы оператору как беду на ровном месте.
 */
export function policyBadgeFacts(node: {
  policyId: string | null;
  cores?: { cores: NodeCore[] } | null;
}): PolicyReachFacts | null {
  if (!node.policyId) return null;
  const facts = policyReachFacts(node.cores?.cores);
  return facts.state === 'applies' ? null : facts;
}

export function policyReachFacts(
  cores: NodeCore[] | null | undefined,
): PolicyReachFacts {
  // `cores` пустой это НЕ «ядер нет»: агент ни разу не отчитался. На этой
  // разнице уже горели, весь полевой флот показывал degraded вечно. Пустой
  // список сюда же: нода, которая отчиталась и не назвала ни одного ядра, не
  // даёт оснований утверждать что-либо про политику.
  if (!cores || cores.length === 0) return { state: 'unknown' };

  const router = cores.find(draws);
  if (router) {
    return { state: 'applies', router: { name: router.name, version: router.version } };
  }

  // Дальше «не применима», и она в ОБЕИХ формах требует одного: чтобы ответили
  // ВСЕ. Отсутствие поля означает «агент старше поля», и это не `false`. Пока
  // хоть одно ядро молчит, оно может оказаться тем самым, которое политику
  // рисует и стоит на машине, и любой отказ был бы отказом по неполному
  // списку. Частичный ответ годится, чтобы сказать «да», и не годится, чтобы
  // сказать «нет»: на этом же правиле стоят ворота движков, и оно писано после
  // двух инцидентов.
  const everyoneAnswered = cores.every((c) => c.rendersPolicy !== undefined);
  if (!everyoneAnswered) return { state: 'unknown' };

  // Ядро умеет, но бинарника на машине нет. Отдельная причина, потому что
  // оператору тут надо не ждать цепь, а поставить ядро.
  if (cores.some((c) => c.rendersPolicy === true)) {
    return { state: 'not-applicable', gap: 'router-not-installed' };
  }

  return { state: 'not-applicable', gap: 'no-router' };
}
