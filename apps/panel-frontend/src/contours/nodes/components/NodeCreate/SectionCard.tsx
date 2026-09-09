import { Box, Stack, Text } from '@mantine/core';
import { CARD, HAIRLINE, MIST, MONO } from '@/contours/nodes/lib/colors';
export function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack
      gap={16}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: MIST,
          }}
        >
          {title}
        </Text>
      </Box>
      {children}
    </Stack>
  );
}

/** A switch that owns a whole row, with the sentence it turns on beside it. */
