import { CYAN, DISPLAY, HAIRLINE, MIST, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
export function BarButton({
  children,
  primary,
  icon,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  icon?: 'arrow' | 'back' | 'server' | 'tick';
  disabled?: boolean;
  onClick?: () => void;
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
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon === 'tick' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke={CYAN}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'back' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M19 12h-14" fill="none" stroke={MIST} strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="M11 18l-6 -6l6 -6"
            fill="none"
            stroke={MIST}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'server' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={CYAN} strokeWidth="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={CYAN} strokeWidth="2" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: primary ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
      {icon === 'arrow' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M5 12h14" fill="none" stroke={CYAN} strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="M13 6l6 6l-6 6"
            fill="none"
            stroke={CYAN}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </UnstyledButton>
  );
}

/** Lightning bolt: the profile/inbound glyph used across the panel. */
