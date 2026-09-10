import { IconExternalLink, IconLink, IconRefresh } from '@tabler/icons-react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, DIM_TEXT, DISPLAY, FIELD_EDGE, GROUND, HAIRLINE, MIST, MONO, RED, SNOW, WELL } from '@/contours/users/lib/colors';
import { LABEL } from '@/contours/users/lib/userForm';
import { copyToClipboard } from '@/lib/ui/clipboard';
import { relativeTime } from '@/lib/ui/relativeTime';
import { fetchAuthStatus } from '@/lib/auth/api';
import { subscriptionUrl } from '@/lib/domain/users';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { User } from '@/lib/domain/users';

/**
 * The one address the client actually holds, and the two things an operator
 * does to it.
 *
 * It lived only in the row menu, which meant answering "what link does this
 * person have" required closing the form you opened to find out. Revoking is
 * the loudest button in the modal and says what it costs directly under it.
 */
export function SubscriptionCard({
  user,
  onRevoke,
}: {
  user: User;
  onRevoke: (user: User) => void;
}) {
  const { t } = useTranslation();
  // Same key the roster uses, so this reads the cache rather than asking again
  // for the public URL the link is built from.
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  const url = subscriptionUrl(user.subscriptionToken, status.data?.panel);

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        padding: '12px 14px',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconLink size={13} stroke={1.7} color={CYAN} />
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{t('userDrawer.subscription')}</Text>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM_TEXT }}>
          {t('userDrawer.subUpdated', { when: relativeTime(user.updatedAt, t).text })}
        </Text>
      </Box>

      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 8px 8px 12px',
          borderRadius: 8,
          backgroundColor: WELL,
          border: `1px solid ${FIELD_EDGE}`,
        }}
      >
        <Text
          title={url}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 11,
            lineHeight: '14px',
            color: '#8A9BB2',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {url}
        </Text>
        <UnstyledButton
          onClick={() => copyToClipboard(url)}
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            padding: '5px 10px',
            borderRadius: 6,
            backgroundColor: CYAN,
          }}
        >
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 600, color: GROUND }}>
            {t('userDrawer.copy')}
          </Text>
        </UnstyledButton>
      </Box>

      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Action
          href={url}
          icon={<IconExternalLink size={12} stroke={1.7} color={MIST} />}
          label={t('userDrawer.openAsClient')}
          color="#8A9BB2"
          edge={HAIRLINE}
        />
        <Action
          onClick={() => onRevoke(user)}
          icon={<IconRefresh size={12} stroke={1.7} color={RED} />}
          label={t('userDrawer.revoke')}
          color={RED}
          edge={`${RED}44`}
        />
      </Box>

      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM_TEXT }}>
        {t('userDrawer.revokeHint')}
      </Text>
    </Box>
  );
}

function Action({
  href,
  onClick,
  icon,
  label,
  color,
  edge,
}: {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  label: string;
  color: string;
  edge: string;
}) {
  const style = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 6,
    padding: '7px 12px',
    borderRadius: 7,
    border: `1px solid ${edge}`,
    color: SNOW,
  };
  const inner = (
    <>
      {icon}
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color }}>{label}</Text>
    </>
  );
  return href ? (
    <UnstyledButton component="a" href={href} target="_blank" rel="noopener noreferrer" style={style}>
      {inner}
    </UnstyledButton>
  ) : (
    <UnstyledButton onClick={onClick} style={style}>
      {inner}
    </UnstyledButton>
  );
}
