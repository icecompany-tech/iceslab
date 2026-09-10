import { Box, Text } from '@mantine/core';
import { DIM, HAIRLINE, MONO } from '@/contours/nodes/lib/colors';
export function Sep() {
  return <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>;
}

export function Divider() {
  return <Box style={{ height: 1, width: '100%', backgroundColor: HAIRLINE }} />;
}
