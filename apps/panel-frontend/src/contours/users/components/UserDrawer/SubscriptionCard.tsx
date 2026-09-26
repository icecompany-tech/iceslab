import { IconExternalLink, IconLink, IconRefresh } from '@tabler/icons-react';
import { Box, Select, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { userProtocols, withProtocols } from '@/contours/users/lib/subscriptionProtocols';
import { CARD, CYAN, FAINT, DISPLAY, FIELD_EDGE, HAIRLINE, MIST, MONO, RED, SNOW, WELL } from '@/contours/users/lib/colors';
import { LABEL } from '@/contours/users/lib/userForm';
import { CopyButton } from '@/ui/CopyButton';
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
  endpoints,
}: {
  user: User;
  onRevoke: (user: User) => void;
  /** Эндпоинты пользователя: из них список протоколов для ссылки на один. */
  endpoints?: readonly { protocol: string }[];
}) {
  const { t } = useTranslation();
  // Same key the roster uses, so this reads the cache rather than asking again
  // for the public URL the link is built from.
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  // Вся подписка или один протокол (BACK 55dacc5): боту оператора нужна
  // ссылка на протокол. Один за раз, без мультивыбора.
  const protocols = userProtocols(endpoints);
  const [picked, setPicked] = useState<string | null>(null);
  const only = picked && protocols.includes(picked as never) ? picked : null;
  const url = withProtocols(subscriptionUrl(user.subscriptionToken, status.data?.panel), only ? [only] : []);

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
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
          {t('userDrawer.subUpdated', { when: relativeTime(user.updatedAt, t).text })}
        </Text>
      </Box>

      {protocols.length > 0 && (
        <Select
          size="xs"
          aria-label={t('userDrawer.subScope')}
          data={[
            { value: '', label: t('userDrawer.subAll') },
            ...protocols.map((p) => ({ value: p, label: p })),
          ]}
          value={only ?? ''}
          allowDeselect={false}
          onChange={(v) => setPicked(v || null)}
          style={{ maxWidth: 240 }}
        />
      )}

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
        {/* Тот же приём, что у строк «Что может набрать»: наведение, и
            «Скопировано» на полторы секунды, иначе не видно, ушло ли. */}
        <CopyButton text={url} label={t('userDrawer.copy')} variant="solid" />

      </Box>
      {only && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: CYAN }}>
          {t('userDrawer.subOnly', { protocol: only })}
        </Text>
      )}

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

      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
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
