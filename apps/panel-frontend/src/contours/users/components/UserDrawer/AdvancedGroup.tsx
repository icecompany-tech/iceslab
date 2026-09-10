import type { ReactNode } from 'react';
import { Box, Text } from '@mantine/core';
import { LABEL } from '@/contours/users/lib/userForm';
import { MIST, MONO } from '@/contours/users/lib/colors';
export function AdvancedGroup({
  icon,
  title,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Box style={{ color: MIST, display: 'flex' }}>{icon}</Box>
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{title}</Text>
        {badge && (
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.1em',
              color: '#F5B14C',
              backgroundColor: '#F5B14C1A',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            {badge}
          </Text>
        )}
      </Box>
      {children}
    </Box>
  );
}
