import type { ReactNode } from 'react';
import { DISPLAY, FAINT, HAIRLINE, MIST, MONO, SNOW } from '@/contours/traffic/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
/**
 * One tab of the routes screen.
 *
 * `badge` is a string rather than a number on purpose. On two of the three
 * panes the figure means «how many you made», and on the third it used to
 * print 3, which is how many built-in presets EXIST: an operator who has never
 * touched the screen read that as three things they had created. A name of the
 * one in force answers the question the number was pretending to.
 */
export function PaneTab({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: '100%',
        paddingInline: 14,
        borderRadius: 6,
        backgroundColor: active ? HAIRLINE : 'transparent',
      }}
    >
      {icon}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: '14px',
          color: active ? MIST : FAINT,
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {badge}
      </Text>
    </UnstyledButton>
  );
}
