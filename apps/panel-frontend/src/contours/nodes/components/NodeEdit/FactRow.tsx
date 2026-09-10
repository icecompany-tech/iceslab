import { Box, Text } from '@mantine/core';
import { DISPLAY, MIST, MONO, SNOW } from '@/contours/nodes/lib/colors';
export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, lineHeight: '15px', color: SNOW }}>
        {value}
      </Text>
    </Box>
  );
}

/** A 3px bar with its own caption line. Grey when the agent reported nothing. */
