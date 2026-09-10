import { AMBER, DIM, FAINT, HAIRLINE, MIST, MONO, MOSS, RED, SNOW } from '@/contours/nodes/lib/colors';
import { Box, Stack, Text } from '@mantine/core';
export function Meter({
  icon,
  label,
  detail,
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  percent: number | null;
}) {
  const tone = percent === null ? DIM : percent >= 90 ? RED : percent >= 70 ? AMBER : MOSS;
  return (
    <Stack gap={4}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        {icon}
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            color: MIST,
          }}
        >
          {label}
        </Text>
        <Text
          style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT, flex: 1, minWidth: 0 }}
        >
          {detail}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, lineHeight: '13px', color: SNOW }}>
          {percent === null ? '-' : `${Math.round(percent)}%`}
        </Text>
      </Box>
      <Box style={{ height: 3, width: '100%', borderRadius: 999, backgroundColor: HAIRLINE }}>
        <Box
          style={{
            height: 3,
            borderRadius: 999,
            backgroundColor: tone,
            width: `${Math.min(100, Math.max(0, percent ?? 0))}%`,
          }}
        />
      </Box>
    </Stack>
  );
}
