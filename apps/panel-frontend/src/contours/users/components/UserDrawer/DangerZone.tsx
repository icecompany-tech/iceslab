import { IconAlertTriangle } from '@tabler/icons-react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { AMBER, CARD, DIM_TEXT, DISPLAY, HAIRLINE, RED, SNOW } from '@/contours/users/lib/colors';
import { LABEL } from '@/contours/users/lib/userForm';
import { useTranslation } from 'react-i18next';
import type { User } from '@/lib/domain/users';

/**
 * The three actions that change what the person on the other end experiences,
 * gathered where they can be read before they are taken.
 *
 * They were spread across the row menu, where a click sits one pixel away from
 * "Edit" and the only warning is the confirm dialog after the fact. Here each
 * one says what it does to the client in a full sentence, and the button is
 * across the row rather than under the cursor.
 */
export function DangerZone({
  user,
  onResetTraffic,
  onRevoke,
  onDelete,
}: {
  user: User;
  onResetTraffic: (user: User) => void;
  onRevoke: (user: User) => void;
  onDelete: (user: User) => void;
}) {
  const { t } = useTranslation();

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconAlertTriangle size={13} stroke={2} color={RED} />
        <Text style={{ ...LABEL, letterSpacing: '0.14em', color: RED }}>
          {t('userDrawer.dangerTitle')}
        </Text>
      </Box>

      <Row
        title={t('userDrawer.resetTrafficTitle')}
        body={t('userDrawer.resetTrafficBody')}
        action={t('userDrawer.resetTrafficAction')}
        accent={AMBER}
        onClick={() => onResetTraffic(user)}
      />
      <Row
        title={t('userDrawer.revokeTitle')}
        body={t('userDrawer.revokeBody')}
        action={t('userDrawer.revoke')}
        accent={RED}
        onClick={() => onRevoke(user)}
      />
      <Row
        title={t('userDrawer.deleteTitle')}
        body={t('userDrawer.deleteBody')}
        action={t('common.delete')}
        accent={RED}
        onClick={() => onDelete(user)}
      />
    </Box>
  );
}

function Row({
  title,
  body,
  action,
  accent,
  onClick,
}: {
  title: string;
  body: string;
  action: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '11px 12px',
        borderRadius: 8,
        border: `1px solid ${accent}33`,
      }}
    >
      <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM_TEXT }}>
          {body}
        </Text>
      </Box>
      <UnstyledButton
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          height: 30,
          paddingInline: 14,
          borderRadius: 7,
          border: `1px solid ${accent}55`,
        }}
      >
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, color: accent }}>
          {action}
        </Text>
      </UnstyledButton>
    </Box>
  );
}
