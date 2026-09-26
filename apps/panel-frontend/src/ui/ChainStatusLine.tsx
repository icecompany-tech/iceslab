import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import type { ChainFacts } from '@/lib/domain/chainStatus';
import { coreReason } from '@/lib/domain/syncRefusal';
import { SyncRefusalStrip } from '@/ui/SyncRefusalStrip';
import { MIST, MOSS, RED } from '@/lib/ui/tokens';
import { relativeTime } from '@/lib/ui/relativeTime';

// Краски из общих токенов; шрифт остаётся строкой на месте, строки шрифтов в
// палитру не кладутся.
const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * Состояние процесса цепи на ноде, одной строкой, и красной полосой, когда он
 * упал.
 *
 * Компонент только красит: что именно можно сказать, решает `chainFacts`.
 * Молчание ноды здесь СЕРОЕ, а не красное: это «нет данных», и разница между
 * ним и отказом это разница между незнанием и фактом.
 */
export function ChainStatusLine({ facts, compact = false }: { facts: ChainFacts; compact?: boolean }) {
  const { t } = useTranslation();

  if (facts.state === 'down') {
    // Причина есть: показываем её тем же кодом, что и отказ ядра, чтобы
    // длинный вывод резался и раскрывался одинаково.
    if (facts.error) {
      return (
        <SyncRefusalStrip
          refusal={{ at: facts.sentAt, reason: coreReason(facts.error), full: facts.error }}
          compact={compact}
          tag={t('chain.tag')}
          title={t('chain.downTitle')}
          note={t('chain.downNote')}
        />
      );
    }
    // Причины нода не назвала. Пустая полоса хуже строки: сам факт остаётся,
    // выдуманного текста под ним нет.
    return <Dot color={RED} text={t('chain.downNoReason')} compact={compact} />;
  }

  if (facts.state === 'unknown') {
    return <Dot color={MIST} text={t('chain.noData')} compact={compact} />;
  }

  // E57: связи с нодой нет, отчёт остался от последнего опроса. Серым и с
  // подписью, а не зелёным «работает»: это не текущее знание.
  if (facts.state === 'stale') {
    const when = facts.since ? relativeTime(facts.since, t).text : null;
    const key = facts.was === 'up' ? (facts.version ? 'chain.staleUpVersion' : 'chain.staleUp') : 'chain.staleDown';
    return (
      <Dot
        color={MIST}
        text={`${t(key, { version: facts.version ?? '' })}${when ? ` ${t('chain.staleSince', { when })}` : ''}`}
        compact={compact}
      />
    );
  }

  return (
    <Dot
      color={MOSS}
      text={facts.version ? t('chain.upVersion', { version: facts.version }) : t('chain.up')}
      compact={compact}
    />
  );
}

function Dot({ color, text, compact }: { color: string; text: string; compact: boolean }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: color, flexShrink: 0 }} />
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: compact ? 11 : 12,
          lineHeight: compact ? '16px' : '17px',
          color,
        }}
      >
        {text}
      </Text>
    </Box>
  );
}
