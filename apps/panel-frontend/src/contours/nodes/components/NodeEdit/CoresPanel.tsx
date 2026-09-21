import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { Node, NodeCore } from '@/lib/domain/nodes';
import {
  CARD,
  DISPLAY,
  FAINT,
  GROUND,
  HAIRLINE,
  MIST,
  MONO,
  MOSS,
  SNOW,
  WELL,
} from '@/contours/nodes/lib/colors';
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
 * ТРИ состояния строки, и третье не округление второго:
 *
 *   настроено        у ядра есть инбаунд, и оно должно работать.
 *   не настроено     адаптер зарегистрирован, инбаунда нет. Обычное состояние
 *                    здоровой ноды, а не беда: так выглядит ядро, которое
 *                    оператор ещё не включил.
 *   панель не знает  `cores` пустой. Это НЕ «ядер нет»: так выглядит нода,
 *                    которая ещё ни разу не отчиталась, и заявлять по ней
 *                    что-либо про ядра нельзя.
 *
 * Слова «работает» здесь нет, и это не забывчивость. `NodeCoreInfo` в панели
 * это ИНВЕНТАРЬ: `running` из отчёта агента сознательно не сохраняется, потому
 * что копия живости протухала бы рядом с нодой, про которую панель уже знает,
 * что та лежит (transport.ts, комментарий у типа). Живость целиком живёт в
 * статусе ноды, и секция отправляет туда, а не выдумывает её заново.
 *
 * Нет здесь и слов «не установлено». Агент отвечает, НАСТРОЕНО ли ядро
 * (`provisioned`), и ничего не говорит про то, лежит ли бинарник на машине.
 * Пока в отчёте нет отдельного `installed`, «не настроено» и «бинарника нет»
 * неразличимы, и писать второе значит выдумывать.
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
            <CoreRow key={`${c.name}:${c.engine ?? ''}`} core={c} />
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

function CoreRow({ core }: { core: NodeCore }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  // `provisioned` ОТСУТСТВУЕТ у агента старше поля, и это не `false`: читаем
  // как «настроено», то есть как вело себя всё до появления поля.
  const state = core.provisioned === false ? 'idle' : 'configured';
  const tone = state === 'configured' ? MOSS : FAINT;

  const script = BOOTSTRAP[core.name];
  const command = script ? `sudo ${NODE_DIR}/apps/node/scripts/${script} && sudo systemctl restart iceslab-node` : null;

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

        {core.version && (
          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>{core.version}</Text>
        )}

        <Box style={{ flex: 1 }} />

        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: tone }}>
          {t(`nodeEdit.coresState.${state}`)}
        </Text>

        {/* Кнопка НЕ ставит ядро. Панель не выполняет скрипты на чужой машине:
            это RCE по построению, и на публичном AGPL-продукте такого быть не
            может. Она открывает готовую строку для вставки в ssh. */}
        {state === 'idle' && command && (
          <UnstyledButton
            type="button"
            onClick={() => setShown((v) => !v)}
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
            {t(shown ? 'nodeEdit.coresHideCommand' : 'nodeEdit.coresShowCommand')}
          </UnstyledButton>
        )}
      </Box>

      {state === 'idle' && command && shown && (
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

function fmtWhen(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
