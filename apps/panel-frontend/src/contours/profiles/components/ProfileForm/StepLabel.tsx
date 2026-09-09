import type { ReactNode } from 'react';
import { Text } from '@mantine/core';

/**
 * Step caption above a chip row in the xray config card: a numbered marker in
 * cyan, then the step name. Numbers come from the label text itself, so the
 * three columns read as one sequence left to right.
 */
export function StepLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#7A8BA3',
      }}
    >
      {children}
    </Text>
  );
}
