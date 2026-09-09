import { Text, UnstyledButton } from '@mantine/core';

/**
 * One choice in a step row. A pill, not a Mantine Chip: the artboard carries
 * selection with fill and weight alone, and the check glyph a Chip insists on
 * would make every row jump a few pixels as the choice moves.
 */
export function PillChip({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
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
        padding: '6px 14px',
        borderRadius: 999,
        backgroundColor: active ? '#7DD3FC29' : '#0B1420',
        border: `1px solid ${active ? '#7DD3FC' : '#1C2A3D'}`,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Text
        style={{
          fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 12,
          fontWeight: active ? 600 : 400,
          lineHeight: '16px',
          color: active ? '#C8D4E3' : '#7A8BA3',
        }}
      >
        {label}
      </Text>
    </UnstyledButton>
  );
}
