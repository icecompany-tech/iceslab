import { Box, Text } from '@mantine/core';
import { CYAN, DIM, DISPLAY, FAINT, HAIRLINE, MIST, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { LockIcon } from '@/contours/traffic/components/Routes/icons';
export function LockedRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Box
      className="routes-rule"
      style={{ paddingBlock: 13, paddingInline: 22, backgroundColor: WELL, borderTop: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <LockIcon size={13} color={DIM} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: MIST }}>
          {label}
        </Text>
      </Box>
      <Box style={{ width: 200, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CYAN, flexShrink: 0 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '17px', color: SNOW }}>{value}</Text>
      </Box>
      <Text
        style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}
      >
        {note}
      </Text>
    </Box>
  );
}
