import { CARD, CYAN, DISPLAY, HAIRLINE, MIST, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
export function SmallButton({
  children,
  icon,
  accent,
  open,
  height = 28,
  radius = 8,
  onClick,
}: {
  children: React.ReactNode;
  icon?: 'copy' | 'chevron' | 'download';
  accent?: boolean;
  open?: boolean;
  height?: number;
  radius?: number;
  onClick?: () => void;
}) {
  const stroke = accent ? CYAN : MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        height,
        paddingInline: height >= 28 ? 12 : 10,
        borderRadius: radius,
        backgroundColor: accent && height < 28 ? CARD : WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {icon === 'copy' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth="2" />
          <path
            d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'download' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 4v12" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
          <path
            d="M7 12l5 5l5 -5"
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M5 20h14" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: height >= 28 ? 12 : 11,
          fontWeight: 500,
          lineHeight: height >= 28 ? '16px' : '15px',
          color: accent ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
      {icon === 'chevron' && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
        >
          <path
            d="M6 9l6 6l6 -6"
            fill="none"
            stroke={MIST}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </UnstyledButton>
  );
}

/**
 * One beat of what happens after the button. Done wears a moss tick, the beat
 * in flight wears a cyan dot, everything after it stays grey.
 */
