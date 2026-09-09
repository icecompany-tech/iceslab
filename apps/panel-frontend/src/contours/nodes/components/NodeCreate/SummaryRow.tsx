import { Box, Text } from '@mantine/core';
import { DISPLAY, HAIRLINE, MIST, MONO, SNOW } from '@/contours/nodes/lib/colors';
export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderTop: `1px solid ${HAIRLINE}`,
        width: '100%',
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: SNOW }}>{value}</Text>
    </Box>
  );
}

/** Titled block of the form: icon in accent, caption muted. */
