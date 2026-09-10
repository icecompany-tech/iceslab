import type { Node } from '@/lib/domain/nodes';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import { DISPLAY, FAINT, HAIRLINE, MONO, SNOW, VIOLET, WELL } from '@/contours/nodes/lib/colors';
export function RoutesHeader({
  node,
  role,
  balancer,
}: {
  node: Node;
  role: string;
  balancer?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '18px 20px',
        backgroundColor: WELL,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, lineHeight: '20px', color: SNOW }}>
        {node.name}
      </Text>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: 6,
          backgroundColor: `${VIOLET}1A`,
          border: `1px solid ${VIOLET}`,
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: VIOLET,
          }}
        >
          {balancer ? t('nodeEdit.routes.entryChip') : t(`nodeEdit.routes.chip.${role}`)}
        </Text>
      </Box>
      <Box style={{ flex: 1 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
        {t('nodeEdit.routes.readOnly')}
      </Text>
    </Box>
  );
}
