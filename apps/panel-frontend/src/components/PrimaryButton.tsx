import { Button, type ButtonProps } from '@mantine/core';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

// Calmed primary cyan (palette shade 6), matching the --mantine-color-cyan-filled
// override in index.css. The neon #7DD3FC was eye-searing as a solid CTA fill on
// the dark surface; the deeper tone still reads as the primary action and keeps
// dark GROUND text legible (~5.5:1).
const CYAN = '#2A93D1';
const GROUND = '#08101A';

interface Props extends Omit<ButtonProps, 'children'>, Omit<ComponentPropsWithoutRef<'button'>, keyof ButtonProps | 'children'> {
  children: ReactNode;
}

/**
 * Standard "create"/"primary action" button: solid cyan with dark text,
 * 500 weight, 12px uppercase letters with mono letter-spacing, 36px height.
 * Use everywhere a hero CTA appears so the Create / Add buttons look
 * identical across pages.
 */
export function PrimaryButton({ children, style, ...rest }: Props) {
  return (
    <Button
      {...rest}
      style={{
        backgroundColor: CYAN,
        color: GROUND,
        fontWeight: 500,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontSize: 12,
        height: 36,
        ...style,
      }}
    >
      {children}
    </Button>
  );
}
