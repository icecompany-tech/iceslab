import { Text } from '@mantine/core';
import { MIST, MONO } from '@/contours/nodes/lib/colors';
export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}
