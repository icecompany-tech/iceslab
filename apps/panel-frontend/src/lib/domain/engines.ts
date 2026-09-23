import { LINK_CELLS } from '@iceslab/shared';
import type { EngineName } from '@iceslab/shared';
import type { Node } from '@/lib/domain/nodes';
import { protocolLabelCompact } from '@/lib/domain/protocols';
import { PLAIN_LABEL, plainSubprotocolOf } from '@/lib/domain/xraySubprotocol';
import { coreVersionOf } from '@/lib/domain/coreVersion';

/**
 * The pair (protocol, engine), which is what the dispatcher on a node actually
 * matches and what the panel used to show half of.
 *
 * «hy2» in a list is not an answer: Hysteria 2 is served by its own daemon, by
 * sing-box, and (from xray v26.3.27) by xray. Different config, different
 * statistics, different ability to carry a cascade leg.
 *
 * ⚠ `EngineName` comes from the shared contract, NOT from a spelling of our
 * own. Four of the seven engines are single-protocol cores whose engine name
 * equals the protocol, and the browser inventing a `native` alias beside them
 * would be a third vocabulary meeting the other two. That is exactly the trap
 * in CLAUDE.local.md: one name, two forms of value. «Свой демон» below is a
 * WORD for those engines, not a value.
 */
export type { EngineName };

export interface EnginePair {
  /** Protocol enum value, or a link-cell name where the pair describes a link. */
  protocol: string;
  engine: EngineName;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Engines that are one protocol's own core: their name says nothing an
 *  operator does not already read in the protocol, so they get one word. */
const OWN_DAEMON = new Set<EngineName>(['hysteria', 'amneziawg', 'naive', 'mieru', 'mtproto']);

/**
 * The engine inside a PAIR, where the protocol stands right next to it:
 * «Hysteria 2 · свой демон». Naming the daemon again there would repeat the
 * word the operator has already read.
 */
export function engineWord(engine: EngineName, t: T): string {
  if (engine === 'xray') return t('engine.xray');
  if (engine === 'singbox') return t('engine.singbox');
  return OWN_DAEMON.has(engine) ? t('engine.own') : engine;
}

/**
 * The engine ON ITS OWN, in a list of what a machine runs. Here the name is the
 * whole content: «свой демон» in a list of cores would say which kind of core
 * it is and not which one, so a node running AmneziaWG and one running mieru
 * would read identically.
 */
export function engineCoreWord(engine: EngineName, t: T): string {
  if (engine === 'xray') return t('engine.xray');
  if (engine === 'singbox') return t('engine.singbox');
  return engine;
}

/** «Hysteria 2 · свой демон». One place, so the two halves never drift apart
 *  across the screens that print them. */
export function pairLabel(pair: EnginePair, t: T): string {
  return t('engine.pair', {
    protocol: protocolLabelCompact(pair.protocol),
    engine: engineWord(pair.engine, t),
  });
}

/**
 * What a pair LOSES compared with the same protocol on another engine.
 *
 * The label says which two things were paired; this says what the pairing
 * costs, and it is the half an operator cannot look up. Hysteria 2 on xray has
 * no Salamander obfuscation at all, and in RU that is the part that gets
 * through the DPI, so «Hysteria 2 · ядро xray» without the caveat reads as the
 * same product served by a different binary, which it is not.
 *
 * Keyed by the pair, never by the protocol: the same protocol on its own daemon
 * has nothing to warn about. Empty today for every pair the panel can show,
 * because the one caveat that exists belongs to a pair the backend does not
 * offer yet (the link builder cannot see the engine). The slot is here so the
 * row already has room for it, and so the second caveat has somewhere to go
 * instead of being bolted onto a screen.
 */
const PAIR_CAVEATS: Record<string, string[]> = {
  'hysteria:xray': ['engine.caveat.noSalamander'],
};

/** i18n keys of the caveats on this pair, in the order they should be read. */
export function pairCaveats(pair: EnginePair): string[] {
  return PAIR_CAVEATS[`${pair.protocol}:${pair.engine}`] ?? [];
}

/**
 * The pair a PROFILE is: its protocol and the core that will render it.
 *
 * Always answerable, unlike the same question about a node: `effectiveEngine`
 * is resolved on the server and is never null, so a profile row can name both
 * halves today. This is the whole difference between the two sides of the
 * screen, and the reason half the read-only places could be changed in one
 * pass while the other half had to learn to stay quiet.
 */
export function profilePair(profile: {
  protocol: string;
  effectiveEngine: EngineName;
}): EnginePair {
  return { protocol: profile.protocol, engine: profile.effectiveEngine };
}

/**
 * «VLESS · ядро xray» for a profile row, and «SOCKS5 · ядро xray» for the
 * Telegram entries: those are xray profiles by protocol, and only the
 * subprotocol in their config says what a person actually connects to.
 * Without `config` (a caller that does not have it) the protocol answers.
 */
export function profilePairLabel(
  profile: { protocol: string; effectiveEngine: EngineName; config?: unknown },
  t: T,
): string {
  const plain = plainSubprotocolOf(profile);
  if (plain) return t('engine.pair', { protocol: PLAIN_LABEL[plain], engine: engineWord(profile.effectiveEngine, t) });
  return pairLabel(profilePair(profile), t);
}

/**
 * What the install command is about to put on a machine, said as a pair.
 *
 * The one place a node's engine is honestly knowable without a report: on the
 * CREATE form the operator has just chosen it, so this describes an intent
 * rather than a fact, and it is read seconds before the machine exists. Never
 * use it about a node that already runs: by then the only truthful source is
 * what the node reported.
 */
export function installIntentLabel(
  values: { protocol: string; singboxEngine: boolean },
  t: T,
): string {
  const own = pairLabel(
    { protocol: values.protocol, engine: nativeEngineOfIntent(values.protocol) },
    t,
  );
  return values.singboxEngine ? t('engine.plusSingbox', { pair: own }) : own;
}

/** Only for the create form above: which core the installer puts down for this
 *  protocol. The same table exists once in the panel and once in the agent, and
 *  this copy is deliberately confined to a form about a machine that does not
 *  exist yet, where there is nothing to ask. */
function nativeEngineOfIntent(protocol: string): EngineName {
  if (protocol === 'shadowsocks') return 'xray';
  if (protocol === 'tuic' || protocol === 'anytls' || protocol === 'shadowtls') return 'singbox';
  return protocol as EngineName;
}

/**
 * The engines a node REPORTED, or undefined when it never has.
 *
 * ⚠ Nothing here is derived from `node.protocol`. That field is a LABEL saying
 * which adapter was installed as primary, not a list of what the machine can
 * run: a node labelled `tuic` routinely serves an xray profile beside it. The
 * backend measured the cost of reading it as a capability on 2026-09-11, and it
 * refused 23 legitimate pairs. So the three states are the report itself:
 *
 *   undefined   no agent has reported cores yet. Unknown, and the panel says
 *               nothing at all rather than guessing in either direction.
 *   []          it reported and runs nothing.
 *   non-empty   the fact.
 */
export function nodeEngines(node: Pick<Node, 'engines'>): EngineName[] | undefined {
  return node.engines;
}

/**
 * The node's cores in words: «ядро xray, движок sing-box».
 *
 * The two edge answers are words as well, never a blank: an empty string in a
 * sentence about what a machine runs reads as a rendering bug, and «не
 * сообщила» and «ни одного» are different facts.
 */
export function engineListWords(node: Pick<Node, 'engines'>, t: T): string {
  const engines = node.engines;
  if (!engines) return t('engine.coresUnknown');
  if (engines.length === 0) return t('engine.coresNone');
  return engines.map((e) => engineCoreWord(e, t)).join(', ');
}

/**
 * The node's cores in words, each with ITS OWN version where it reported one:
 * «ядро xray 26.3.27, движок sing-box 1.13.14».
 *
 * The version comes from the core that engine runs as (`cores[].version`).
 * `node.coreVersion` is xray's and nobody else's (T7), so it may only stand
 * beside xray, and only when the cores list did not give xray a version.
 * Printing it after a list that ends in sing-box read as sing-box's version.
 */
export function engineVersionWords(
  node: Pick<Node, 'engines' | 'cores' | 'coreVersion'>,
  t: T,
): string {
  const engines = node.engines;
  if (!engines) return t('engine.coresUnknown');
  if (engines.length === 0) return t('engine.coresNone');
  const cores = node.cores?.cores ?? [];
  return engines
    .map((e) => {
      const own = cores
        .filter((c) => (c.engine ?? c.name) === e)
        .map(coreVersionOf)
        .find((v): v is string => v !== null);
      const version = own ?? (e === 'xray' ? (node.coreVersion ?? null) : null);
      const word = engineCoreWord(e, t);
      return version ? `${word} ${version}` : word;
    })
    .join(', ');
}

/**
 * Does a core on this node render a profile whose effective engine is this?
 *
 * Membership in a reported set, which is the whole check: `effectiveEngine`
 * arrives on the profile already resolved, so the protocol-to-native-core table
 * stays on the server where it has one copy. Undefined means the node has never
 * reported, and that is NOT false.
 */
export function nodeRunsEngine(
  node: Pick<Node, 'engines'>,
  engine: EngineName,
): boolean | undefined {
  const engines = node.engines;
  if (!engines) return undefined;
  return engines.includes(engine);
}

/**
 * Can this node carry a leg of a cascade.
 *
 * Both realised link cells (vless and shadowsocks-2022) are built into the xray
 * config of the node, see cascade.config.ts:16-18 in the backend, so the
 * question is whether xray is among the cores it reported. Undefined while it
 * has reported nothing: a node may well be running xray under a label that says
 * something else.
 */
export function nodeCarriesCascadeLink(node: Pick<Node, 'engines'>): boolean | undefined {
  return nodeRunsEngine(node, 'xray');
}

/**
 * Пары «протокол + движок» у тех ячеек, за которыми стоит ровно одна пара.
 *
 * Список ячеек СВОЙ здесь больше не объявляется: он в контракте (`LINK_CELLS`
 * в `packages/shared/src/transport.ts`), и копия из двух значений держала ногу
 * позиции на двух ячейках, пока сервер уже принимал четыре. Разрез 5 фазы 5
 * (цепь `xray-вход -> hy2 -> tuic -> ss -> выход`) в панели из-за этого не
 * собирался вовсе.
 *
 * Пара есть не у каждой ячейки, и это не пробел. `hy2` и `tuic` поднимает
 * sing-box, и назвать их парой «протокол+ядро» значило бы выдумать протокол,
 * которого в наших именах нет: у них имя ячейки и есть имя протокола. Кто их
 * несёт, говорит таблица движков контракта, а не эта.
 */
const CELL_PAIRS: Record<string, EnginePair> = {
  vless: { protocol: 'vless', engine: 'xray' },
  // Хранимое `xray` это та же ячейка vless: колонка держит имя ДВИЖКА по
  // историческим причинам, и это ровно та путаница, которую модуль закрывает.
  xray: { protocol: 'vless', engine: 'xray' },
  shadowsocks: { protocol: 'shadowsocks', engine: 'xray' },
};

const LINK_CELL_VALUES = new Set<string>(LINK_CELLS);

/**
 * Пара протокол+движок за хранимым именем ячейки, и `null`, когда пары нет:
 * либо ячейка чужая, либо она из тех, у кого пары не бывает.
 */
export function linkCellPair(value: string | null | undefined): EnginePair | null {
  if (!value) return null;
  return CELL_PAIRS[value] ?? null;
}

/** Значение, которое сервер примет сегодня. Хранимое `xray` это та же ячейка
 *  vless, поэтому оно законно, хотя в контрактном списке его нет. */
export function isRealisedLinkCell(value: string | null | undefined): boolean {
  return value === 'xray' || (Boolean(value) && LINK_CELL_VALUES.has(value as string));
}

/**
 * Список для селектора ячейки, ОДИН на ногу позиции и ногу направления.
 *
 * Ячейки берутся из контракта целиком: их четыре, и все четыре сервер
 * принимает и у позиции, и у направления (`CascadePositionSchema` и
 * `CascadeDirectionUpdate` в `cascade.schemas.ts` ссылаются на один
 * `LinkCellValue`). Пока список был свой и короткий, нога позиции предлагала
 * две ячейки из четырёх.
 *
 * Подпись у ячейки с парой это пара («VLESS · ядро xray»), у остальных имя
 * ячейки как есть: выдумывать им протокол не на чем, а движки пишет рядом сама
 * строка ноги.
 *
 * Уже сохранённое значение, которого в списке нет, остаётся в нём: пустой
 * селектор над существующими данными читается как потеря.
 */
export function linkCellOptions(
  current: string | null,
  t: T,
): { value: string; label: string }[] {
  const options = LINK_CELLS.map((cell) => {
    const pair = CELL_PAIRS[cell];
    return { value: cell as string, label: pair ? pairLabel(pair, t) : cell };
  });
  if (current === 'xray') {
    options.push({ value: 'xray', label: pairLabel(CELL_PAIRS.xray, t) });
  } else if (current && !LINK_CELL_VALUES.has(current)) {
    options.push({ value: current, label: t('engine.cellUnrealised', { name: current }) });
  }
  return options;
}
