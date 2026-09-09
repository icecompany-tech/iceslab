import type { ReactNode } from 'react';
import { Group, Stack, Text } from '@mantine/core';

/**
 * A titled block of the form. The caption stays muted and the icon carries the
 * colour; the protocol config card additionally wears its accent as a top edge,
 * which is what separates "what this is called" from "how the wire behaves".
 */
export function SectionCard({
  title,
  icon,
  accent,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  accent?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack
      gap={16}
      style={{
        padding: 20,
        borderRadius: 10,
        backgroundColor: '#0F1A28',
        border: '1px solid #1C2A3D',
        borderTop: accent ? `3px solid ${accent}` : '1px solid #1C2A3D',
      }}
    >
      <Group justify="space-between" wrap="nowrap" style={{ width: '100%' }}>
        <Group gap={8} wrap="nowrap">
          {icon}
          <Text
            style={{
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#7A8BA3',
            }}
          >
            {title}
          </Text>
        </Group>
        {action}
      </Group>
      {children}
    </Stack>
  );
}
