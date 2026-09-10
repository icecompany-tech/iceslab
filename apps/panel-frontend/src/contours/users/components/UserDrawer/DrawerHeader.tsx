import { IconUser, IconX } from '@tabler/icons-react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CYAN, DISPLAY, HAIRLINE, MIST, MONO, SNOW } from '@/contours/users/lib/colors';
import { useTranslation } from 'react-i18next';
import type { Props } from '@/contours/users/components/UserDrawer';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * Who is being edited, or that a new user is being made, plus the presets
 * that fill the form in one click.
 */
export function DrawerHeader({
  isEdit,
  onClose,
  user,
}: Pick<UserForm, 'isEdit'> & { onClose: Props['onClose']; user: Props['user'] }) {
  const { t } = useTranslation();

  return (
    <>
        {/* Header */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '22px 24px 18px',
            borderBottom: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
          }}
        >
          <Box style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Box
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: `${CYAN}1A`,
                border: `1px solid ${CYAN}33`,
                color: CYAN,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <IconUser size={18} stroke={1.8} />
            </Box>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Text
                style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 500, lineHeight: '22px', color: SNOW }}
              >
                {isEdit && user ? user.username : t('userDrawer.newTitle')}
              </Text>
              <Text
                style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.16em', lineHeight: '12px', color: MIST }}
              >
                {isEdit ? t('userDrawer.editSubtitle') : t('userDrawer.newSubtitle')}
              </Text>
            </Box>
          </Box>
          <UnstyledButton
            onClick={onClose}
            aria-label={t('common.cancel')}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: MIST,
            }}
          >
            <IconX size={16} stroke={1.8} />
          </UnstyledButton>
        </Box>
    </>
  );
}
