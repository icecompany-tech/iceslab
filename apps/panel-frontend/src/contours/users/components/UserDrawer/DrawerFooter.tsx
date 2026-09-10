import { Box, Text } from '@mantine/core';
import { FooterButton } from '@/contours/users/components/UserDrawer/FooterButton';
import { HAIRLINE, MIST, MONO, WELL } from '@/contours/users/lib/colors';
import { useTranslation } from 'react-i18next';
import type { Props } from '@/contours/users/components/UserDrawer';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * The action bar: cancel, and the one button that saves.
 */
export function DrawerFooter({
  isEdit,
  onClose,
  loading,
}: Pick<UserForm, 'isEdit'> & { onClose: Props['onClose']; loading: Props['loading'] }) {
  const { t } = useTranslation();

  return (
    <>
        {/* Footer */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px 20px',
            backgroundColor: WELL,
            borderTop: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: MIST }}>
            ⏎ {isEdit ? t('userDrawer.saveShort') : t('userDrawer.createShort')}
          </Text>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FooterButton onClick={onClose}>{t('common.cancel')}</FooterButton>
            <FooterButton type="submit" primary disabled={loading}>
              {isEdit ? t('common.save') : t('userDrawer.create')}
            </FooterButton>
          </Box>
        </Box>
    </>
  );
}
