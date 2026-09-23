import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Box, Text } from '@mantine/core';
import type { HostHiddenFacts } from '@/lib/domain/hosts';
import { AMBER } from '@/lib/ui/tokens';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * Хост, который ни одна подписка не выдаст: нода стоит в каскаде не входом.
 *
 * Янтарная, а не красная: это не поломка, а следствие того, как устроен каскад
 * (клиенты заходят через вход), и оператор мог поставить хост так нарочно.
 * Но молчать нельзя: иначе хост выглядит рабочим, а подписка его не отдаёт.
 * Имя каскада это ссылка на его страницу, где это и решается.
 *
 * Что сказать, решает `hostHiddenFacts`; `null` здесь не рисуется вовсе.
 */
export function HostHiddenLine({ facts, compact = false }: { facts: HostHiddenFacts | null; compact?: boolean }) {
  const { t } = useTranslation();
  if (!facts) return null;
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
      <Box
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER, flexShrink: 0, marginTop: compact ? 5 : 6 }}
      />
      <Text style={{ fontFamily: DISPLAY, fontSize: compact ? 11 : 12, lineHeight: compact ? '15px' : '17px', color: AMBER }}>
        {t('hostHidden.before', { node: facts.nodeName })}
        <Link
          to={`/nodes/cascades/${facts.cascadeId}`}
          onClick={(e) => e.stopPropagation()}
          style={{ color: AMBER, textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          {facts.cascadeName}
        </Link>
        {t('hostHidden.after')}
      </Text>
    </Box>
  );
}
