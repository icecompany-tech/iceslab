import { Box, Text } from '@mantine/core';
import { EDGE, HAIRLINE, MIST, MONO, WELL } from '@/contours/nodes/lib/colors';
export function Chip({ children, color, edge }: { children: React.ReactNode; color?: string; edge?: boolean }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: color ? `${color}14` : WELL,
        border: `1px solid ${color ? `${color}2E` : edge ? EDGE : HAIRLINE}`,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: color ? '0.1em' : undefined,
          lineHeight: '12px',
          color: color ?? MIST,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

/** The mono caption every card on this page wears. */
