import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import { PlainButton } from '@/contours/nodes/components/NodeEdit/PlainButton';
import { CARD, DISPLAY, HAIRLINE, SNOW } from '@/contours/nodes/lib/colors';

/**
 * Shown instead of the editor when the id in the URL matches no node: either
 * the fetch is still in flight, or the node is gone and the only way on is back
 * to the list.
 */
export function NodeNotFound({ isLoading, onBack }: { isLoading: boolean; onBack: () => void }) {
  const { t } = useTranslation();

  return (
    <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
      <Stack align="center" gap={14}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
          {isLoading ? t('common.loading') : t('nodeEdit.notFound')}
        </Text>
        {!isLoading && <PlainButton onClick={onBack}>{t('nodeEdit.backToList')}</PlainButton>}
      </Stack>
    </Box>
  );
}
