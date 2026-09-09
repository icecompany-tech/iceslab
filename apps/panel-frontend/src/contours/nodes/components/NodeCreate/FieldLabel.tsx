import { Text } from '@mantine/core';
import { MIST, MONO } from '@/contours/nodes/lib/colors';
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        lineHeight: '12px',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}
