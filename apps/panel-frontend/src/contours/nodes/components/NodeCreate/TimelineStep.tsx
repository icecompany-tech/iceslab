import { Box, Stack, Text } from '@mantine/core';
import { CYAN, DIM, DISPLAY, EDGE, FAINT, MIST, MOSS, SNOW, WELL } from '@/contours/nodes/lib/colors';
export function TimelineStep({
  state,
  title,
  hint,
}: {
  state: 'done' | 'current' | 'pending';
  title: string;
  hint: string;
}) {
  const accent = state === 'done' ? MOSS : state === 'current' ? CYAN : null;
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
      <Box
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          backgroundColor: accent ? `${accent}1A` : WELL,
          border: `1px solid ${accent ?? EDGE}`,
        }}
      >
        {state === 'done' ? (
          <svg width="11" height="11" viewBox="0 0 24 24">
            <path
              d="M5 12l5 5L20 7"
              fill="none"
              stroke={MOSS}
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <Box
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: state === 'current' ? CYAN : DIM,
            }}
          />
        )}
      </Box>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 12,
            fontWeight: 500,
            lineHeight: '16px',
            color: state === 'pending' ? MIST : SNOW,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Stack>
    </Box>
  );
}
