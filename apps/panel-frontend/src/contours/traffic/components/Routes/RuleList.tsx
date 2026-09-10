import type { ReactNode } from 'react';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { CYAN, DISPLAY, FAINT, HAIRLINE, MIST, MONO, RAISED, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { Caption } from '@/contours/traffic/components/Routes/Labels';
export function ListHead({ label, count }: { label: string; count: number }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 18px',
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Caption>{label}</Caption>
      <Box style={{ flex: 1, minWidth: 0 }} />
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>{count}</Text>
    </Box>
  );
}

/** Import: a label that opens the file picker and hands back the text. */

export function ListRow({
  selected,
  title,
  sub,
  badge,
  onClick,
}: {
  selected: boolean;
  title: string;
  sub: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '13px 18px',
        width: '100%',
        textAlign: 'left',
        backgroundColor: selected ? RAISED : 'transparent',
        borderLeft: `2px solid ${selected ? CYAN : 'transparent'}`,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '17px',
            color: selected ? SNOW : MIST,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '13px', color: FAINT }}>{sub}</Text>
      </Stack>
      {badge && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 18,
            paddingInline: 7,
            borderRadius: 5,
            flexShrink: 0,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.08em',
              lineHeight: '11px',
              textTransform: 'uppercase',
              color: FAINT,
            }}
          >
            {badge}
          </Text>
        </Box>
      )}
    </UnstyledButton>
  );
}

export function ListEmpty({ children }: { children: ReactNode }) {
  return (
    <Box style={{ padding: '20px 18px' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST, textAlign: 'center' }}>{children}</Text>
    </Box>
  );
}
