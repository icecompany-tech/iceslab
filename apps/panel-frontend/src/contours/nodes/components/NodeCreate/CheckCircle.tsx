import { Box } from '@mantine/core';
import { CYAN, DIM } from '@/contours/nodes/lib/colors';
export function CheckCircle({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <Box
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        border: `1px solid ${checked ? CYAN : DIM}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'inherit',
      }}
    >
      {checked && (
        <svg width="8" height="8" viewBox="0 0 24 24">
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke={CYAN}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Box>
  );
}

/** Small mono pill. `edge` uses the lighter hairline for neutral counters. */
