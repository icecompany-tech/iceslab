import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { Node, NodeCore } from '@/lib/domain/nodes';
import { awgLabel, awgVersionFacts, readCoreAwg, type AwgVersionFacts } from '@/lib/domain/awg';
import { coreVersionOf } from '@/lib/domain/coreVersion';
import { coreVersionFacts, type CoreVersionLine } from '@/lib/domain/coreVersions';
import { CopyButton } from '@/ui/CopyButton';
import {
  AMBER,
  CARD,
  DISPLAY,
  FAINT,
  GROUND,
  HAIRLINE,
  MIST,
  MONO,
  MOSS,
  RED,
  SNOW,
  WELL,
} from '@/contours/nodes/lib/colors';

/** Что оператору делать с этим ядром. Имена состояний названы по ДЕЙСТВИЮ, а не
 *  по полю отчёта: `absent` это «идти на машину», `idle` это «привязать
 *  профиль», и путать их дорого. */
type CoreState = 'configured' | 'idle' | 'absent';
import { ChipIcon } from '@/contours/nodes/components/NodeEdit/icons';

/**
 * Какие ядра стоят на этой ноде и в каком они состоянии.
 *
 * Состав спрашивается у САМОЙ НОДЫ и приезжает в `Node.cores` из `/healthz`,
 * а не собирается здесь из `protocol` и `singboxEngine`. Причина записана в
 * схеме: таблица в панели разошлась бы с агентом, и разошлась бы молча. По той
 * же причине агент регистрирует адаптер на каждый протокол, а незанятое ядро
 * это нормальное состояние здоровой ноды: когда это один раз проглядели, весь
 * флот показывал `degraded` вечно, то есть статус перестал что-либо значить.
 *
 * ЧЕТЫРЕ состояния, и ни одно не округление соседнего:
 *
 *   настроено        у ядра есть инбаунд, и оно должно работать.
 *   не настроено     бинарник на машине есть, инбаунда нет. Обычное состояние
 *                    здоровой ноды, а не беда: так выглядит ядро, которое
 *                    оператор ещё не включил. Действие тут ПАНЕЛЬНОЕ, привязать
 *                    профиль.
 *   бинарника нет    адаптер зарегистрирован, а файла на машине нет. Действие
 *                    тут МАШИННОЕ, зайти по ssh и поставить, и смешивать эти
 *                    два значит посылать человека не туда.
 *   панель не знает  `cores` пустой. Это НЕ «ядер нет»: так выглядит нода,
 *                    которая ещё ни разу не отчиталась, и заявлять по ней
 *                    что-либо про ядра нельзя.
 *
 * Отсутствие `installed` это НЕ `false`: агент старше поля не говорит про
 * бинарник ничего, и строка ведёт себя ровно так, как вела до появления поля.
 * Прочитать молчание как «нет файла» значило бы разослать весь сегодняшний флот
 * ставить то, что уже стоит.
 *
 * Слова «работает» здесь нет, и это не забывчивость. `NodeCoreInfo` в панели
 * это ИНВЕНТАРЬ: `running` из отчёта агента сознательно не сохраняется, потому
 * что копия живости протухала бы рядом с нодой, про которую панель уже знает,
 * что та лежит (transport.ts, комментарий у типа). Живость целиком живёт в
 * статусе ноды, и секция отправляет туда, а не выдумывает её заново.
 */
export function CoresPanel({ node }: { node: Node }) {
  const { t } = useTranslation();
  const cores = node.cores?.cores;

  return (
    <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 16px', width: '100%' }}>
        <ChipIcon size={14} color={MIST} />
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.14em',
            lineHeight: '14px',
            textTransform: 'uppercase',
            color: MIST,
          }}
        >
          {t('nodeEdit.coresTitle')}
        </Text>
        <Box style={{ flex: 1 }} />
        {cores && cores.length > 0 && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
            {t('nodeEdit.coresReportedAt', { at: fmtWhen(node.cores?.observedAt) })}
          </Text>
        )}
      </Box>

      {/* Пусто и молчание это разные вещи, и разводятся они здесь, а не
          пустым списком, который читается как «ядер нет». */}
      {!cores || cores.length === 0 ? (
        <Box style={{ padding: '0 20px 20px' }}>
          <Text style={{ fontSize: 13, lineHeight: '19px', color: MIST }}>
            {t('nodeEdit.coresUnknown')}
          </Text>
        </Box>
      ) : (
        <Stack gap={0}>
          {cores.map((c) => (
            <CoreRow
              key={`${c.name}:${c.engine ?? ''}`}
              core={c}
              nodeId={node.id}
              // Поколение AWG: намерение ноды против версии, которую сообщило
              // ядро. Только у amneziawg и только когда сервер поле отдаёт.
              awg={c.name === 'amneziawg' ? awgVersionFacts(node.awgProtocol, readCoreAwg(c)) : null}
            />
          ))}
          {/* Инвентарь, а не живость: поднято ли ядро прямо сейчас, говорит
              статус ноды, и повторять его здесь второй раз значит завести
              второй источник правды, который разойдётся с первым. */}
          <Box style={{ borderTop: `1px solid ${HAIRLINE}`, padding: '12px 20px 16px' }}>
            <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>
              {t('nodeEdit.coresInventoryNote')}
            </Text>
          </Box>
        </Stack>
      )}
    </Box>
  );
}

/** Бутстрапы, которые инсталлятор уже положил на машину. Ключ это ПРОТОКОЛ,
 *  значение это имя скрипта в `apps/node/scripts/`. У xray своего бутстрапа
 *  нет: он приезжает основным инсталлятором, и строки для него не будет. */
const BOOTSTRAP: Record<string, string> = {
  hysteria: 'bootstrap-hysteria.sh',
  amneziawg: 'bootstrap-amneziawg.sh',
  mtproto: 'bootstrap-mtg.sh',
  mieru: 'bootstrap-mieru.sh',
  naive: 'bootstrap-naive.sh',
  singbox: 'bootstrap-singbox.sh',
};

/** Где инсталлятор держит репозиторий ноды. Совпадает с `ICESLAB_NODE_DIR`
 *  по умолчанию в `scripts/install-iceslab-node.sh`. */
const NODE_DIR = '/opt/iceslab-node';

function CoreRow({ core, nodeId, awg }: { core: NodeCore; nodeId: string; awg: AwgVersionFacts | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shown, setShown] = useState(false);

  // Порядок проверок задан тем, что оператору делать. Нет файла: идти на
  // машину, и никакая привязка профиля этого не заменит, поэтому вопрос про
  // инбаунд даже не задаётся. Оба поля ОТСУТСТВУЮТ у агента старше них, и это
  // не `false`: молчание читается как «как было раньше».
  const state: CoreState =
    core.installed === false ? 'absent' : core.provisioned === false ? 'idle' : 'configured';
  const tone = state === 'configured' ? MOSS : state === 'absent' ? AMBER : FAINT;
  const version = coreVersionOf(core);
  // Версия против манифеста: вердикт судит judgeCoreVersion из контракта,
  // здесь только слова. Пусто, когда судить нечего (нет файла, нет версии).
  const verLines = coreVersionFacts(core);
  const update = verLines.find((l) => l.command?.kind === 'command')?.command;
  const updateText = update?.kind === 'command' ? update.text : null;
  const [updateShown, setUpdateShown] = useState(false);

  const script = BOOTSTRAP[core.name];
  const command = script ? `sudo ${NODE_DIR}/apps/node/scripts/${script} && sudo systemctl restart iceslab-node` : null;
  // Строку показываем только там, где она к месту: у ядра, которое стоит и
  // просто не занято, предложение переустановить его сбивает с толку.
  const canShowCommand = state === 'absent' && command !== null;

  return (
    <Box style={{ borderTop: `1px solid ${HAIRLINE}`, padding: '14px 20px' }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
        <Text style={{ fontFamily: MONO, fontSize: 13, lineHeight: '18px', color: SNOW }}>{core.name}</Text>

        {/* Движок называется только когда он НЕ родной для протокола: иначе
            строка «hysteria (hysteria)» повторяет сама себя. */}
        {core.engine && core.engine !== core.name && (
          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>
            {t('nodeEdit.coresVia', { engine: core.engine })}
          </Text>
        )}

        {/* Своя версия ядра, никогда не node.coreVersion: та версия xray.
            С вердиктом манифеста, когда компонент известен; иначе голая. */}
        {verLines.length > 0
          ? verLines.map((l) => (
              <Text
                key={l.component}
                style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: verdictTone(l.verdict.kind) }}
              >
                {verdictWords(l, t)}
              </Text>
            ))
          : version && (
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>{version}</Text>
            )}

        {/* Одно слово, и только при ответе ДА. Политику уровня ноды сегодня
            применяет ровно одно ядро из девяти, и здесь видно, какое именно.
            Отсутствие поля означает «агент старше поля», а не «не рисует»,
            поэтому молчание тут это молчание, а не отрицание. */}
        {core.rendersPolicy === true && (
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: MOSS,
              padding: '2px 7px',
              borderRadius: 999,
              backgroundColor: `${MOSS}14`,
              flexShrink: 0,
            }}
          >
            {t('nodeEdit.coresRendersPolicy')}
          </Text>
        )}

        <Box style={{ flex: 1 }} />

        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: tone }}>
          {t(`nodeEdit.coresState.${state}`)}
        </Text>

        {/* Кнопка НЕ ставит ядро. Панель не выполняет скрипты на чужой машине:
            это RCE по построению, и на публичном AGPL-продукте такого быть не
            может. Она открывает готовую строку для вставки в ssh. */}
        {canShowCommand && (
          <RowButton onClick={() => setShown((v) => !v)}>
            {t(shown ? 'nodeEdit.coresHideCommand' : 'nodeEdit.coresHowToInstall')}
          </RowButton>
        )}

        {/* Ядро стоит и свободно: дальше дело панельное, и нода уходит в адрес
            заранее выбранной, чтобы её не искали заново в списке из тридцати. */}
        {state === 'idle' && (
          <RowButton onClick={() => navigate(`/hosts/new?nodeId=${nodeId}`)}>
            {t('nodeEdit.coresAttachProfile')}
          </RowButton>
        )}

        {/* Версия ушла от пина, выше потолка или известна как поломка: строка
            для ssh, которая вернёт её на пин. Панель её не выполняет. */}
        {updateText && (
          <RowButton onClick={() => setUpdateShown((v) => !v)}>
            {t(updateShown ? 'nodeEdit.coresHideCommand' : 'nodeEdit.coreVer.howToUpdate')}
          </RowButton>
        )}
      </Box>

      {/* Почему версия плохая (причина из манифеста), почему пина нет, и почему
          команды нет, если двигать надо, а скрипт не умеет. */}
      {verLines.map((l) => {
        const why =
          l.verdict.kind === 'known-bad' || l.verdict.kind === 'above-ceiling'
            ? { text: l.verdict.reason, color: RED }
            : l.verdict.kind === 'unpinned'
              ? { text: t('nodeEdit.coreVer.unpinnedWhy', { reason: l.verdict.reason }), color: FAINT }
              : null;
        const noCmd = l.command?.kind === 'none' ? t(`nodeEdit.coreVer.noCommand.${l.command.why}`) : null;
        if (!why && !noCmd) return null;
        return (
          <Stack key={`why-${l.component}`} gap={4} style={{ marginTop: 6, paddingLeft: 18 }}>
            {why && <Text style={{ fontSize: 12, lineHeight: '17px', color: why.color }}>{why.text}</Text>}
            {noCmd && <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>{noCmd}</Text>}
          </Stack>
        );
      })}

      {updateText && updateShown && (
        <Stack gap={8} style={{ marginTop: 12 }}>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '11px 13px',
              borderRadius: 8,
              backgroundColor: GROUND,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: '17px',
                color: SNOW,
                flex: 1,
                minWidth: 0,
                overflowWrap: 'anywhere',
              }}
            >
              {updateText}
            </Text>
            <CopyButton text={updateText} label={t('common.copy')} />
          </Box>
          <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>{t('nodeEdit.coreVer.afterUpdate')}</Text>
        </Stack>
      )}

      {/* Поколение AmneziaWG. Расхождение намерения с фактом янтарным: клиенты
          с конфигом одного поколения к ядру другого не подключатся, а на
          экране это выглядело бы как исправное ядро. */}
      {awg && (
        <Text
          style={{
            marginTop: 6,
            paddingLeft: 18,
            fontSize: 12,
            lineHeight: '17px',
            color: awg.mismatch ? AMBER : FAINT,
          }}
        >
          {/* Без `!`: расхождение и так подразумевает сообщённую версию, но
              обещание в типе вчера уже роняло страницу, пусть проверит код. */}
          {/* Как ядро исполняется, это третья часть строки, и только когда ядро
              это сообщило. В строке расхождения она стоит в скобках у факта:
              хвостом после «не подключатся» она читалась бы как продолжение
              вывода, а это часть того, ЧТО стоит на машине. */}
          {awg.mismatch && awg.reported !== null
            ? t(awg.runtime ? 'nodeEdit.coresAwgMismatchRuntime' : 'nodeEdit.coresAwgMismatch', {
                intended: awgLabel(awg.intended),
                reported: awgLabel(awg.reported),
                runtime: awg.runtime ? t(`nodeEdit.coresAwgRuntime.${awg.runtime}`) : '',
              })
            : awg.reported === null
              ? t('nodeEdit.coresAwgNoReport', { version: awgLabel(awg.intended) })
              : `${t('nodeEdit.coresAwg', { version: awgLabel(awg.intended) })}${
                  awg.runtime ? ` · ${t(`nodeEdit.coresAwgRuntime.${awg.runtime}`)}` : ''
                }`}
        </Text>
      )}

      {canShowCommand && shown && (
        <Stack gap={8} style={{ marginTop: 12 }}>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '11px 13px',
              borderRadius: 8,
              backgroundColor: GROUND,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: '17px',
                color: SNOW,
                flex: 1,
                minWidth: 0,
                overflowWrap: 'anywhere',
              }}
            >
              {command}
            </Text>
            <UnstyledButton
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(command).then(
                  () => notifications.show({ color: 'green', message: t('nodeEdit.coresCopied') }),
                  () => notifications.show({ color: 'red', message: t('nodeEdit.coresCopyFailed') }),
                );
              }}
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 8,
                backgroundColor: WELL,
                border: `1px solid ${HAIRLINE}`,
                fontFamily: DISPLAY,
                fontSize: 12,
                color: MIST,
                flexShrink: 0,
              }}
            >
              {t('common.copy')}
            </UnstyledButton>
          </Box>
          {/* Дожимать руками нечего: состав ядер приносит тот же поллер, что
              и статус, поэтому нода сама скажет о новом ядре. */}
          <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>{t('nodeEdit.coresAfterInstall')}</Text>
        </Stack>
      )}
    </Box>
  );
}

/** Цвет вердикта: серый у спокойных, янтарь у дрейфа, красный у плохих. */
function verdictTone(kind: CoreVersionLine['verdict']['kind']): string {
  if (kind === 'drift') return AMBER;
  if (kind === 'known-bad' || kind === 'above-ceiling') return RED;
  return FAINT;
}

/** «26.3.27, как в пине», «модуль 1.0.20260611, как в пине», «1.13.12, пин 1.13.14». */
function verdictWords(l: CoreVersionLine, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const v = l.part ? `${t(`nodeEdit.coreVer.part.${l.part}`)} ${l.reported}` : l.reported;
  const d = l.verdict;
  switch (d.kind) {
    case 'intended':
      return t(d.isPin ? 'nodeEdit.coreVer.intendedPin' : 'nodeEdit.coreVer.intendedChosen', { v });
    case 'drift':
      return t('nodeEdit.coreVer.drift', { v, intended: d.intended });
    case 'above-ceiling':
      return t('nodeEdit.coreVer.aboveCeiling', { v, ceiling: d.ceiling });
    case 'known-bad':
      return t('nodeEdit.coreVer.knownBad', { v });
    case 'unpinned':
      return t('nodeEdit.coreVer.unpinned', { v });
  }
}

/** Кнопка в строке ядра. Обе выглядят одинаково намеренно: они равны по весу,
 *  и подсвечивать одну значило бы говорить, что чинить надо сперва её. */
function RowButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 12px',
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        fontFamily: DISPLAY,
        fontSize: 12,
        color: MIST,
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

function fmtWhen(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
