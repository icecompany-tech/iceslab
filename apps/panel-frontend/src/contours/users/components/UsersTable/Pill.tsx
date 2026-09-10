import type { ReactNode } from 'react';
import { Box } from '@mantine/core';
import { MONO } from '@/contours/users/lib/textStyles';
export function Pill({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'inline-flex',
        padding: '3px 9px',
        borderRadius: 999,
        backgroundColor: `${accent}1A`,
        border: `1px solid ${accent}33`,
        color: accent,
        ...MONO,
        fontSize: 10,
        lineHeight: '12px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Squad pill. Borderless and in the display face, because a squad name is
 * operator-written content, not a status from a fixed set.
 */
