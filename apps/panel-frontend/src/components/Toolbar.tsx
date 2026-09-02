import { Box, Loader, TextInput, UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * The one row every list page carries above its table: search on the left,
 * actions on the right. One height (36px), one shell (card fill + hairline),
 * so a page reads as a row of equals instead of a pile of button styles.
 *
 * The big display hero these pages used to open with is gone: the page title
 * and its counts live in the topbar line now, and the vertical space goes to
 * rows the operator actually came to read.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const SHELL = {
  height: 36,
  borderRadius: 8,
  backgroundColor: CARD,
  border: `1px solid ${HAIRLINE}`,
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
} as const;

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
      {children}
    </Box>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  leftSection,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  leftSection?: ReactNode;
}) {
  return (
    <TextInput
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder={placeholder}
      leftSection={leftSection}
      styles={{
        root: { flex: 1, minWidth: 0 },
        input: {
          height: 36,
          minHeight: 36,
          backgroundColor: CARD,
          borderColor: HAIRLINE,
          color: SNOW,
          fontFamily: DISPLAY,
          fontSize: 13,
        },
      }}
    />
  );
}

export function ToolbarButton({
  icon,
  label,
  onClick,
  /** Tints the icon cyan: marks the one action that creates something. */
  primary,
  disabled,
  /** Count pill on the right, e.g. how many filters are currently applied. */
  badge,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  badge?: number;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      disabled={disabled}
      style={{
        ...SHELL,
        gap: 8,
        padding: badge === undefined ? '0 16px' : '0 14px',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Box style={{ display: 'flex', color: primary ? CYAN : MIST }}>{icon}</Box>
      <Box style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: SNOW }}>{label}</Box>
      {badge !== undefined && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 18,
            minWidth: 18,
            padding: '0 5px',
            borderRadius: 999,
            backgroundColor: `${CYAN}24`,
            color: CYAN,
            fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
            fontSize: 10,
            fontWeight: 600,
            lineHeight: '12px',
          }}
        >
          {badge}
        </Box>
      )}
    </UnstyledButton>
  );
}

export function ToolbarIconButton({
  icon,
  onClick,
  title,
  loading,
}: {
  icon: ReactNode;
  onClick?: () => void;
  title?: string;
  loading?: boolean;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{ ...SHELL, width: 36, justifyContent: 'center', color: MIST, cursor: 'pointer' }}
    >
      {loading ? <Loader size={14} color={MIST} /> : icon}
    </UnstyledButton>
  );
}
