import { Box, Text } from '@mantine/core';
import { CYAN, DISPLAY, VIOLET, VIOLET_HI } from '@/contours/users/lib/colors';
export function ProtocolChip({ protocol }: { protocol: string }) {
  // AmneziaWG gets the violet slot: it is the one protocol that is not an
  // xray-family inbound, and operators pick it for a different reason.
  const isWg = protocol.toLowerCase().includes('amnezia') || protocol.toLowerCase() === 'awg';
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        padding: '0 7px',
        borderRadius: 6,
        backgroundColor: isWg ? `${VIOLET}29` : `${CYAN}24`,
      }}
    >
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: isWg ? VIOLET_HI : CYAN,
          textTransform: 'uppercase',
        }}
      >
        {protocol}
      </Text>
    </Box>
  );
}
