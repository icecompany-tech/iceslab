import { Box, Text } from '@mantine/core';
import { awgGenerationBadge, type AwgProtocol } from '@/lib/domain/awg';
import { MOSS } from '@/lib/ui/tokens';

const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * «3.1» рядом с именем профиля AmneziaWG этого поколения (a4ad8bc): карточка
 * профиля и хост. У 1.x значка нет (awgGenerationBadge).
 */
export function AwgGenerationBadge({
  profile,
}: {
  profile: { protocol: string; awgProtocol?: AwgProtocol | null } | null | undefined;
}) {
  const label = awgGenerationBadge(profile);
  if (!label) return null;
  return (
    <Box
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        padding: '1px 6px',
        borderRadius: 4,
        backgroundColor: `${MOSS}1A`,
        border: `1px solid ${MOSS}40`,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', letterSpacing: '0.06em', color: MOSS }}>
        AWG {label}
      </Text>
    </Box>
  );
}
