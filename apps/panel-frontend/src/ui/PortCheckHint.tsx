import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import type { PortCheckResult } from '@/lib/domain/portCheck';

/**
 * Что панель знает про этот порт на этой ноде, одной строкой.
 *
 * Четыре ответа, и три из них НЕ красные. Зелёный говорит «свободен», серый
 * говорит «коллизий не нашли, но список ядер неизвестен», и разница между ними
 * это разница между знанием и его отсутствием: красить второе в зелёный значит
 * обещать за ноду, которая молчит.
 *
 * Строка ничего не запрещает. Save остаётся живым: последняя стена это бэкенд
 * на сохранении, и его отказ показывается своими словами, как отказ ядра.
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
    return result.certainty === 'full' ? (
      <Line tone={MOSS}>{t('portCheck.free', { port, transport })}</Line>
    ) : (
      <Line tone={MIST}>{t('portCheck.partial')}</Line>
    );
  }

  // По ПЕРВОМУ конфликту: их может быть несколько, но человеку нужно сменить
  // порт, а не прочитать список причин, по которым этот занят.
  const c = result.conflicts[0];
  if (!c) return <Line tone={MIST}>{t('portCheck.partial')}</Line>;

  const common = { port: c.port, transport: c.transport };
  if (c.kind === 'profile') return <Line tone={RED}>{t('portCheck.busyProfile', { ...common, name: c.name })}</Line>;
  if (c.kind === 'cascade') return <Line tone={RED}>{t('portCheck.busyCascade', { ...common, name: c.name })}</Line>;
  return <Line tone={RED}>{t('portCheck.busyCore', { ...common, owner: ownerWord(c.ownerKey, t) })}</Line>;
}

/**
 * Имя служебного слушателя человеческими словами.
 *
 * Неизвестный ключ показывается КАК ЕСТЬ. Ядро может завести службу раньше, чем
 * панель узнает её имя, и подставить «неизвестная служба» значило бы стереть
 * единственную зацепку, по которой оператор найдёт её на машине.
 */
function ownerWord(key: string, t: (k: string) => string): string {
  const word = t(`portCheck.owner.${key}`);
  return word === `portCheck.owner.${key}` ? key : word;
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
