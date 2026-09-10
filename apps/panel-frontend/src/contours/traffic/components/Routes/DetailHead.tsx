import { Box, Text } from '@mantine/core';
import { CYAN, DISPLAY, FAINT, MONO, SNOW } from '@/contours/traffic/lib/colors';
export function DetailHead({ title, chip, note }: { title: string; chip?: string; note: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', width: '100%' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
        {title}
      </Text>
      {chip && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 20,
            paddingInline: 8,
            borderRadius: 6,
            flexShrink: 0,
            backgroundColor: `${CYAN}14`,
            border: `1px solid ${CYAN}2E`,
          }}
        >
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: CYAN,
            }}
          >
            {chip}
          </Text>
        </Box>
      )}
      <Box style={{ flex: 1, minWidth: 0 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{note}</Text>
    </Box>
  );
}

/** The row nobody wrote and nobody can delete. */
