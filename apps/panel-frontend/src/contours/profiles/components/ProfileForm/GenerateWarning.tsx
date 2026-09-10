import { Box, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { GenerateImpact } from '@/contours/profiles/lib/generateImpact';

const AMBER = '#F5B14C';
const MIST = '#7A8BA3';
const SNOW = '#C8D4E3';
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * What pressing Generate costs, stated before it is pressed.
 *
 * The key belongs to the profile, and every node of every host on that profile
 * serves it. One click therefore invalidates the whole fleet at once and there
 * is no way back: the old key is gone. The three numbers say how wide the blast
 * is, and the confirmation repeats them so the decision is made twice.
 */
export function GenerateWarning({ impact }: { impact: GenerateImpact }) {
  const { t } = useTranslation();

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 8,
        backgroundColor: `${AMBER}10`,
        border: `1px solid ${AMBER}33`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <Fact value={impact.hosts} label={t('profiles.generate.hosts', { count: impact.hosts })} />
        <Fact value={impact.nodes} label={t('profiles.generate.nodes', { count: impact.nodes })} />
        {/* Named, not guessed: the count of configs that go stale needs the
            subscription pipeline, which no endpoint exposes. */}
        <Fact
          value={impact.configs}
          label={t('profiles.generate.configs')}
          hint={t('profiles.generate.configsPending')}
        />
      </Box>
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: MIST }}>
        {t('profiles.generate.body')}
      </Text>
    </Box>
  );
}

function Fact({
  value,
  label,
  hint,
}: {
  value: number | null;
  label: string;
  hint?: string;
}) {
  return (
    <Box style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} title={hint}>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 15,
          fontWeight: 500,
          lineHeight: '18px',
          color: value === null ? MIST : SNOW,
        }}
      >
        {value === null ? '-' : value}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {label}
      </Text>
    </Box>
  );
}
