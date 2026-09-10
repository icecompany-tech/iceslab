import { Box } from '@mantine/core';
import { HAIRLINE } from '@/contours/users/lib/colors';
export function TrafficBar({ percent, color }: { percent: number; color: string }) {
  return (
    <Box
      style={{
        height: 6,
        width: '100%',
        borderRadius: 999,
        backgroundColor: HAIRLINE,
        overflow: 'hidden',
      }}
    >
      <Box
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: color,
          width: `${Math.min(100, Math.max(0, percent))}%`,
        }}
      />
    </Box>
  );
}

// ───── Stats card ─────
