import { useTranslation } from 'react-i18next';
import { Box, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getNodeWithLingering, nodeLingeringOf } from '@/lib/domain/lingering';
import { apiErrorMessage } from '@/lib/net/client';
import { relativeTime } from '@/lib/ui/relativeTime';
import { AMBER, DISPLAY, FAINT, MIST, MONO, MOSS, RED, SNOW } from '@/contours/nodes/lib/colors';

/**
 * A-218: users taken off this node whose connections are still open. xray
 * keeps them until the client closes them, and the panel does not restart the
 * core to cut them (that cuts everyone), so the operator is shown who.
 *
 * Read off the node's own GET every 30 s, the stats poll's pace. A panel
 * older than the field draws nothing; «not checked» is said as such, never
 * as «nobody».
 */
export function LingeringBlock({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['node-lingering', nodeId],
    queryFn: () => getNodeWithLingering(nodeId),
    refetchInterval: 30_000,
  });
  const view = q.data === undefined ? null : nodeLingeringOf(q.data);
  if (view?.kind === 'old-server') return null;

  const value = q.isError
    ? '-'
    : !view
      ? q.data === undefined
        ? t('common.loading')
        : '-'
      : view.kind === 'unchecked'
        ? t('nodeEdit.lingering.unchecked')
        : view.users.length === 0
          ? t('nodeEdit.lingering.none')
          : String(view.users.length);
  const tone = view?.kind === 'known' ? (view.users.length > 0 ? AMBER : MOSS) : FAINT;

  return (
    <>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
          {t('nodeEdit.lingering.label')}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, lineHeight: '15px', color: tone }}>{value}</Text>
      </Box>
      {view?.kind === 'known' && view.users.length > 0 && (
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          {view.users.map((u, i) => (
            <Box key={u.userId ?? `unknown-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: '15px',
                  color: u.username ? SNOW : FAINT,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {u.username ?? t('nodeEdit.lingering.unknownUser')}
                {u.status && u.status !== 'active' && (
                  <span style={{ fontFamily: DISPLAY, color: MIST }}> · {t(`users.statChips.${u.status}`, { defaultValue: u.status })}</span>
                )}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '15px', color: MIST, flexShrink: 0 }}>
                {t('nodeEdit.lingering.sessions', { count: u.sessions })}
              </Text>
            </Box>
          ))}
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, marginTop: 4 }}>
            {t('nodeEdit.lingering.hint', { time: relativeTime(view.observedAt, t).text })}
          </Text>
        </Box>
      )}
      {q.isError && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: RED }}>{apiErrorMessage(q.error)}</Text>
      )}
    </>
  );
}
