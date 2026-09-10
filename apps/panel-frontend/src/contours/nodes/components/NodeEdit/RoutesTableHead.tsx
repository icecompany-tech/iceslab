import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import { FAINT, HAIRLINE, MONO } from '@/contours/nodes/lib/colors';
export function TableHead() {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 20px',
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ width: 26, flexShrink: 0 }} />
      <ColHead style={{ flex: 1, minWidth: 0 }}>{t('nodeEdit.routes.colIf')}</ColHead>
      <ColHead style={{ width: 250, flexShrink: 0 }}>{t('nodeEdit.routes.colThen')}</ColHead>
      <ColHead style={{ width: 430, flexShrink: 0 }}>{t('nodeEdit.routes.colWhy')}</ColHead>
    </Box>
  );
}

export function ColHead({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: FAINT,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}
