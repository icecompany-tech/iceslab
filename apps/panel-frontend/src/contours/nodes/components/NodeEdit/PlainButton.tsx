import { ShieldIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { CYAN, DISPLAY, EDGE, HAIRLINE, MIST, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { KeyIcon, TickIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { Text, UnstyledButton } from '@mantine/core';
export function PlainButton({
  children,
  icon,
  strong,
  edge,
  height = 38,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  icon?: 'key' | 'tick' | 'shield' | 'plus';
  strong?: boolean;
  edge?: boolean;
  height?: number;
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
        height,
        paddingInline: height >= 38 ? 16 : 14,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${edge ? EDGE : HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon === 'key' && <KeyIcon size={14} color={CYAN} />}
      {icon === 'tick' && <TickIcon size={14} color={CYAN} />}
      {icon === 'shield' && <ShieldIcon size={13} color={CYAN} />}
      {icon === 'plus' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 5v14M5 12h14" fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: height >= 34 ? 13 : 12,
          fontWeight: 500,
          lineHeight: '16px',
          color: strong ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}
