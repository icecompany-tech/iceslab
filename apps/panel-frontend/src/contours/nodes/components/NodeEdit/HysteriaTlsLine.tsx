import { useTranslation } from 'react-i18next';
import { Box, Text, UnstyledButton } from '@mantine/core';
import type { HysteriaTlsFacts } from '@/contours/nodes/lib/hysteriaTls';
import { AMBER, FAINT, MIST, MONO, MOSS } from '@/contours/nodes/lib/colors';

/**
 * Строка сертификата под нативной hysteria в «Ядрах» (E30a): какой сертификат
 * нода отдаёт и тот ли, что выпустила панель. Что сказать, решает
 * hysteriaTlsFacts; здесь слова и краска. Расхождение янтарное: это не
 * поломка, а нода, которая ждёт пуша.
 */
export function HysteriaTlsLine({
  facts,
  onRotate,
  rotating,
}: {
  facts: HysteriaTlsFacts;
  /** Кнопка ротации; undefined, когда у ноды нет выпущенной панелью пары. */
  onRotate?: () => void;
  rotating?: boolean;
}) {
  const { t } = useTranslation();
  const until = facts.kind === 'self-signed' && facts.notAfter ? fmtDate(facts.notAfter) : null;
  const text =
    facts.kind === 'acme'
      ? t('nodeEdit.hyTls.acme', { host: facts.host })
      : facts.kind === 'unreported'
        ? t('nodeEdit.hyTls.unreported')
        : [
            t('nodeEdit.hyTls.selfSigned', { fp: facts.fingerprint ?? '?' }),
            facts.match === true ? t('nodeEdit.hyTls.match') : facts.match === false ? t('nodeEdit.hyTls.mismatch') : null,
            until ? t('nodeEdit.hyTls.until', { date: until }) : null,
          ]
            .filter(Boolean)
            .join(', ');
  const tone =
    facts.kind === 'self-signed' && facts.match === false
      ? AMBER
      : facts.kind === 'self-signed' && facts.match === true
        ? MOSS
        : facts.kind === 'unreported'
          ? FAINT
          : MIST;

  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, paddingLeft: 18 }}>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '15px', color: tone, flex: 1, minWidth: 0 }}>
        {text}
      </Text>
      {onRotate && (
        <UnstyledButton onClick={onRotate} disabled={rotating} style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, lineHeight: '16px', color: MIST, textDecoration: 'underline dotted' }}>
            {t('nodeEdit.hyTls.rotate')}
          </Text>
        </UnstyledButton>
      )}
    </Box>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU');
}
