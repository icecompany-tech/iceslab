import type { ReactNode } from 'react';
import { DISPLAY, FAINT, HAIRLINE, MIST, MONO, SNOW } from '@/contours/traffic/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
export function PaneTab({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
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
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: active ? MIST : FAINT }}>
        {count}
      </Text>
    </UnstyledButton>
  );
}
