import { Box, Text } from '@mantine/core';
import { DISPLAY, FAINT, HAIRLINE, MIST, MONO, SNOW } from '@/contours/nodes/lib/colors';
export function RuleRow({
  accent,
  background,
  icon,
  match,
  matchStrong,
  struck,
  muted,
  action,
  actionDot,
  actionBox,
  why,
  whyTone,
}: {
  accent: string;
  background?: string;
  icon?: React.ReactNode;
  match: string;
  matchStrong?: boolean;
  struck?: boolean;
  muted?: boolean;
  action?: string;
  actionDot?: string;
  actionBox?: React.ReactNode;
  why: string;
  whyTone?: string;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 20px',
        borderTop: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        backgroundColor: background ?? 'transparent',
        width: '100%',
      }}
    >
      <Box
        style={{
          width: 23,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </Box>
      <Text
        style={{
          fontFamily: matchStrong ? DISPLAY : MONO,
          fontSize: 13,
          fontWeight: matchStrong ? 500 : 400,
          lineHeight: '16px',
          color: struck || muted ? (struck ? FAINT : MIST) : SNOW,
          textDecoration: struck ? 'line-through' : undefined,
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {match}
      </Text>
      {actionBox ?? (
        <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: 250, flexShrink: 0 }}>
          {actionDot && (
            <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: actionDot, flexShrink: 0 }} />
          )}
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 13,
              lineHeight: '16px',
              color: struck || muted ? MIST : SNOW,
            }}
          >
            {action}
          </Text>
        </Box>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 12,
          lineHeight: '16px',
          color: whyTone ?? FAINT,
          width: 430,
          flexShrink: 0,
        }}
      >
        {why}
      </Text>
    </Box>
  );
}
