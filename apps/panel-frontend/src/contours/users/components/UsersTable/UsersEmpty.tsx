import { IconPlus, IconUsers } from '@tabler/icons-react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CYAN, DISPLAY, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/users/lib/colors';
import { useTranslation } from 'react-i18next';
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * The roster before anyone is on it.
 *
 * Not a shrug: an empty list is the first screen of a fresh install, so it
 * says what the list is for, offers the one action that fills it, and names
 * the other way in for an operator arriving from another panel. The toolbar
 * and the column state stay above it, because those are settings and settings
 * are not missing just because the data is.
 */
export function UsersEmpty({ openCreate }: Pick<UsersPageState, 'openCreate'>) {
  const { t } = useTranslation();

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '72px 24px 84px',
      }}
    >
      <Box
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${CYAN}14`,
          border: `1px solid ${CYAN}33`,
          color: CYAN,
        }}
      >
        <IconUsers size={26} stroke={1.6} />
      </Box>

      <Text style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 500, lineHeight: '26px', color: SNOW }}>
        {t('users.emptyTitle')}
      </Text>

      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          lineHeight: '19px',
          color: MIST,
          maxWidth: 440,
          textAlign: 'center',
        }}
      >
        {t('users.emptyBody')}
      </Text>

      <UnstyledButton
        onClick={openCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 36,
          padding: '0 16px',
          marginTop: 4,
          borderRadius: 8,
          backgroundColor: WELL,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <IconPlus size={14} stroke={2} color={CYAN} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: SNOW }}>
          {t('users.create')}
        </Text>
      </UnstyledButton>

      {/* The second way in. An operator moving a live roster over does not want
          to type it back one account at a time, and the importer is a separate
          tool they have no reason to know about yet. */}
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: MIST }}>
        {t('users.emptyImport')}
      </Text>
    </Box>
  );
}
