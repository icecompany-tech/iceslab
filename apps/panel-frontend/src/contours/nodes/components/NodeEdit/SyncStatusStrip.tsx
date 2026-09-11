import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import type { NodeSyncStatus } from '@/lib/domain/nodes';
import { AMBER, MIST, SNOW } from '@/contours/nodes/lib/colors';

const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const SLATE = '#7A8BA3';

/**
 * "Saved, but not applied yet" on one node.
 *
 * Two unapplied states, and they are not the same problem. A node that is
 * ONLINE and still has not taken the config is a stuck push: somebody has to
 * look. A node that is OFFLINE is simply waiting, the sync cron re-pushes when
 * it comes back, and shouting amber at the operator about it would train them
 * to ignore the colour. So the offline case is stated in grey, as a fact.
 *
 * Nothing is drawn when the config has landed: this is a card about a node,
 * not a status board, and a green "all good" strip on every healthy node is
 * noise that pushes the real thing off the screen.
 */
export function SyncStatusStrip({ status }: { status: NodeSyncStatus | undefined }) {
  const { t } = useTranslation();
  if (!status || status.applied) return null;

  const waiting = !status.online;
  const tone = waiting ? SLATE : AMBER;
  const never = status.lastInboundSyncAt === null;

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%',
        padding: '16px 18px',
        borderRadius: 10,
        backgroundColor: `${tone}0F`,
        border: `1px solid ${tone}33`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
        <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
        <Text style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', color: tone }}>
          {waiting ? t('nodeEdit.syncWaitingTag') : t('nodeEdit.syncPendingTag')}
        </Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
          {t('nodeEdit.syncChangedAt', { at: when(status.configChangedAt) })}
        </Text>
      </Box>

      <Stack gap={4}>
        <Text style={{ fontSize: 13, lineHeight: '19px', color: SNOW }}>
          {waiting ? t('nodeEdit.syncWaitingBody') : t('nodeEdit.syncPendingBody')}
        </Text>
        <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
          {never
            ? t('nodeEdit.syncNever')
            : t('nodeEdit.syncLastApplied', { at: when(status.lastInboundSyncAt!) })}
        </Text>
      </Stack>
    </Box>
  );
}

/** Time of day, which is the granularity this answer is read at: a push either
 *  landed minutes ago or it did not land. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
