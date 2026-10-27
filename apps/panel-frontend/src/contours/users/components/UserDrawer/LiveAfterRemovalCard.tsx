import { IconPlugConnected } from '@tabler/icons-react';
import { Box, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AMBER, DISPLAY, GROUND, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/users/lib/colors';
import { LABEL } from '@/contours/users/lib/userForm';
import { getUserWithLiveAfterRemoval, liveAfterRemovalOf } from '@/lib/domain/lingering';
import { relativeTime } from '@/lib/ui/relativeTime';

/**
 * A-218: the nodes where this user, taken off, still holds a connection. xray
 * leaves the connections open until the client closes them; the panel does
 * not cut them by a core restart, which would cut everyone.
 *
 * Only the «yes» is drawn: the server lists the nodes that answered, so an
 * empty list is «nowhere among the checked», not «nowhere», and says nothing.
 */
export function LiveAfterRemovalCard({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['user-live-after-removal', userId],
    queryFn: () => getUserWithLiveAfterRemoval(userId),
    refetchInterval: 30_000,
  });
  const rows = q.data === undefined || q.isError ? null : liveAfterRemovalOf(q.data);
  if (!rows || rows.length === 0) return null;

  return (
    <Box style={{ borderRadius: 8, border: `1px solid ${HAIRLINE}`, backgroundColor: GROUND, padding: '10px 12px' }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <IconPlugConnected size={13} stroke={1.8} color={AMBER} />
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{t('userDrawer.liveAfterRemoval.title')}</Text>
      </Box>
      <Stack gap={5}>
        {rows.map((r) => (
          <Box
            key={r.nodeId}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 6, backgroundColor: WELL }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: DISPLAY,
                fontSize: 12,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.nodeName}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: AMBER, flexShrink: 0 }}>
              {t('userDrawer.liveAfterRemoval.sessions', { count: r.sessions })}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST, flexShrink: 0 }}>{relativeTime(r.observedAt, t).text}</Text>
          </Box>
        ))}
      </Stack>
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST, marginTop: 8 }}>
        {t('userDrawer.liveAfterRemoval.hint')}
      </Text>
    </Box>
  );
}
