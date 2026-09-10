import type { ReactNode } from 'react';
import { Box, Text } from '@mantine/core';
import { MONO } from '@/contours/traffic/lib/colors';
export function Verdict({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: tone }}>{children}</Text>
    </Box>
  );
}
