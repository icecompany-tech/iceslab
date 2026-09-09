import { Text } from '@mantine/core';
import { MIST, MONO } from '@/contours/nodes/lib/colors';
export function CardCaption({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        lineHeight: '12px',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

/** Compact action inside a card header or field. */
