import type { ReactNode } from 'react';
import { CYAN, DISPLAY, HAIRLINE, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { TickIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { Text, UnstyledButton } from '@mantine/core';
export function Action({
  children,
  disabled,
  title,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 34,
        paddingInline: 14,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <TickIcon size={14} color={CYAN} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
        {children}
      </Text>
    </UnstyledButton>
  );
}
