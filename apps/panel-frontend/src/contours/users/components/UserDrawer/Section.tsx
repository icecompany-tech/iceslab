import type { ReactNode } from 'react';
import { Box, Text } from '@mantine/core';
import { LABEL } from '@/contours/users/lib/userForm';
import { RED } from '@/contours/users/lib/colors';
export function Section({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <Text style={LABEL}>{label}</Text>
        {required && <Text style={{ ...LABEL, color: RED }}>*</Text>}
      </Box>
      {children}
    </Box>
  );
}
