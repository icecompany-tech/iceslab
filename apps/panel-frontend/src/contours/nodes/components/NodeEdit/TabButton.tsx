import { AMBER, CYAN, DISPLAY, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { Box, Text, UnstyledButton } from '@mantine/core';
export function TabButton({
  children,
  active,
  icon,
  badge,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  icon: 'server' | 'route';
  badge?: number;
  onClick: () => void;
}) {
  const stroke = active ? CYAN : MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: active ? `${CYAN}1A` : WELL,
        border: `1px solid ${active ? CYAN : HAIRLINE}`,
      }}
    >
      {icon === 'server' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={stroke} strokeWidth="1.6" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <circle cx="5" cy="6" r="2.2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <circle cx="19" cy="18" r="2.2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <path
            d="M5 8.5v4a3 3 0 0 0 3 3h8.8"
            fill="none"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M9 6h9" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
      {badge !== undefined && badge > 0 && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 18,
            paddingInline: 6,
            borderRadius: 5,
            backgroundColor: `${AMBER}24`,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: AMBER }}>{badge}</Text>
        </Box>
      )}
    </UnstyledButton>
  );
}
