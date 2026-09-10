import type { ReactNode } from 'react';
import { Box, Text } from '@mantine/core';
import { MONO } from '@/contours/traffic/lib/colors';
export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 22,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.08em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: tone,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}
