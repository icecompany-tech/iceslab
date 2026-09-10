import type { ReactNode } from 'react';
import { CYAN, DISPLAY, HAIRLINE, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { TickIcon } from '@/contours/traffic/components/Routes/icons';
import { Text, UnstyledButton } from '@mantine/core';
export function SaveButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
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

/* ───── Import and export ───────────────────────────────────────────────── */

/**
 * The exchange format is ours and deliberately small: a kind, a version and a
 * list of `{ name, rules }`. It is exactly the body the write endpoints will
 * take, so a file exported today stays valid once they exist.
 */
