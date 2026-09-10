import { Box, Text } from '@mantine/core';
import { MONO } from '@/contours/nodes/lib/colors';
export function DotChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        paddingInline: 8,
        borderRadius: 6,
        backgroundColor: `${color}14`,
        border: `1px solid ${color}2E`,
        flexShrink: 0,
      }}
    >
      <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}
