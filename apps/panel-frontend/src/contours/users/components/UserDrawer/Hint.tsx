import { Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { MIST } from '@/contours/users/lib/colors';
export function Hint({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: 11, lineHeight: '16px', color: MIST }}>{children}</Text>
  );
}
