import { IconCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { CARD, CYAN, DISPLAY, HAIRLINE, MIST, SNOW } from '@/contours/users/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
export function FooterButton({
  children,
  onClick,
  type = 'button',
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <UnstyledButton
      component="button"
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 36,
        padding: '0 16px',
        borderRadius: 8,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {primary && <IconCheck size={14} stroke={2.4} color={CYAN} />}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          color: primary ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}

/**
 * The devices holding this user's HWID slots, and the way to free one.
 *
 * Lost when the form moved from a modal to this drawer, which left the limit
 * above it answering half a question: an operator told "3 of 3, reset one"
 * could see the 3 and nothing to act on. The count against the limit is the
 * point of the block, the list is what makes it actionable.
 */
