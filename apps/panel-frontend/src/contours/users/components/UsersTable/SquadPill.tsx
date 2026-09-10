import type { ReactNode } from 'react';
import { Box } from '@mantine/core';
import { MIST, VIOLET } from '@/contours/users/lib/colors';
import { DISPLAY } from '@/contours/users/lib/textStyles';
export function SquadPill({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const accent = muted ? MIST : VIOLET;
  return (
    <Box
      style={{
        display: 'inline-flex',
        padding: '3px 9px',
        borderRadius: 999,
        backgroundColor: `${accent}1A`,
        color: accent,
        ...DISPLAY,
        fontSize: 11,
        lineHeight: '14px',
        whiteSpace: 'nowrap',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </Box>
  );
}
