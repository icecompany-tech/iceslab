import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import type { PortCheckResult, PortOwner, PortTakenCode } from '@/lib/domain/portCheck';
import { conflictSentence, holderWord, refusalSentence } from '@/lib/domain/portWords';

/**
 * Что панель знает про этот порт на этой ноде, одной строкой.
 *
 * Четыре ответа, и три из них НЕ красные. Зелёный говорит «свободен», серый
 * говорит «коллизий не нашли, но список ядер неизвестен», и разница между ними
 * это разница между знанием и его отсутствием: красить второе в зелёный значит
 * обещать за ноду, которая молчит.
 *
 * Строка ничего не запрещает. Save остаётся живым: последняя стена это бэкенд
 * на сохранении, и его отказ рисуется ЭТИМ ЖЕ кодом и теми же словами, см.
 * `PortRefusalLine` ниже.
 */

const MOSS = '#A7D8B9';
const MIST = '#7A8BA3';
const RED = '#E07A5F';
const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function PortCheckHint({
  result,
  checking,
  port,
  transport,
}: {
  result: PortCheckResult | null;
  checking?: boolean;
  /** То, что ПРОВЕРЯЛИ. Из ответа это взять нельзя: у свободного порта список
   *  конфликтов пуст, а назвать порт в зелёной строке всё равно надо. */
  port: number;
  transport: string;
}) {
  const { t } = useTranslation();
  if (checking) return <Line tone={MIST}>{t('portCheck.checking')}</Line>;
  if (!result) return null;

  if (result.ok) {
    // Порт и транспорт называются вместе всегда: 443/tcp и 443/udp это разные
    // сокеты, и «443 свободен» без второй половины отвечает не на тот вопрос.
    const free =
      result.certainty === 'full' ? (
        <Line tone={MOSS}>{t('portCheck.free', { port, transport })}</Line>
      ) : (
        <Line tone={MIST}>{t('portCheck.partial')}</Line>
      );

    // Сосед по номеру, но не по сокету. Второй строкой и серым: это не
    // возражение, а предупреждение о том, что номер в списке уже мелькает.
    const other = result.otherTransport?.holder;
    return (
      <>
        {free}
        {other && (
          <Line tone={MIST}>
            {t('portCheck.freeOtherTransport', {
              port: other.port,
              otherTransport: other.transport,
              holder: holderWord(other, t),
            })}
          </Line>
        )}
      </>
    );
  }

  // По ПЕРВОМУ конфликту: их может быть несколько, но человеку нужно сменить
  // порт, а не прочитать список причин, по которым этот занят.
  const c = result.conflicts[0];
  if (!c) return <Line tone={MIST}>{t('portCheck.partial')}</Line>;
  return <Line tone={RED}>{conflictSentence(c, t)}</Line>;
}

/**
 * Отказ сохранения по занятому порту, теми же словами, что и подсказка.
 *
 * Отдельный компонент, а не ветка в предыдущем: подсказка отвечает на вопрос
 * «можно ли», а это уже ответ «нельзя, и вот почему». Но предложение общее,
 * потому что событие одно, и держать для него два текста значит однажды
 * получить два разных объяснения одной беды.
 */
export function PortRefusalLine({
  code,
  conflicts,
}: {
  code: PortTakenCode;
  conflicts: PortOwner[];
}) {
  const { t } = useTranslation();
  const c = conflicts[0];
  // Конфликт пришёл: он точнее кода, потому что называет и порт, и держателя.
  if (c) return <Line tone={RED}>{conflictSentence(c, t)}</Line>;
  // Списка нет, остаётся код. Фраза без подробностей, но верная.
  return <Line tone={RED}>{refusalSentence(code, t)}</Line>;
}

function Line({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
      <Box
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          backgroundColor: tone,
          flexShrink: 0,
          marginTop: 6,
        }}
      />
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: tone }}>{children}</Text>
    </Box>
  );
}
