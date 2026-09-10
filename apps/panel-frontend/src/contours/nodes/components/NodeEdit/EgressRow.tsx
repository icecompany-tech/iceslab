import { Box, Text } from '@mantine/core';
import { CYAN, DIM, DISPLAY, FAINT, HAIRLINE, MIST, SNOW } from '@/contours/nodes/lib/colors';
export function EgressRow({
  selected,
  disabled,
  title,
  hint,
  trailing,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  hint: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        borderTop: `1px solid ${HAIRLINE}`,
        backgroundColor: selected ? `${CYAN}0F` : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        width: '100%',
      }}
    >
      <Box
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          border: `1px solid ${selected ? CYAN : DIM}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {selected && <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: CYAN }} />}
      </Box>
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: selected ? SNOW : MIST,
          width: 190,
          flexShrink: 0,
        }}
      >
        {title}
      </Text>
      {trailing ?? (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1 }}>
          {hint}
        </Text>
      )}
    </Box>
  );
}
