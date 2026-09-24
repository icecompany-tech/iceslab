import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rotateCascadeTunnels, type CascadeTunnel } from '@/lib/domain/cascades';
import { apiErrorMessage } from '@/lib/net/client';
import { tunnelNotFound, tunnelRows, type TunnelRow } from '@/contours/cascades/lib/tunnels';
import { CardCaption, Note, ShieldIcon, WarnIcon } from '@/contours/cascades/components/CascadeEditor';
import { AMBER, CARD, DISPLAY, FAINT, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/cascades/lib/colors';

/**
 * «Туннели AmneziaWG» of a cascade (phase 8.3): a row per node pair and the
 * one act that changes their keys. A save never re-keys a tunnel, rotation is
 * explicit, and between the two pushes it costs the legs inside it a
 * reconnect, so it is asked for with a confirmation that says so.
 *
 * Drawn only when the cascade has tunnels (tunnelRows).
 */
export function TunnelsCard({
  cascadeId,
  tunnels,
  nodeById,
}: {
  cascadeId: string;
  tunnels: CascadeTunnel[] | undefined;
  nodeById: ReadonlyMap<string, { name: string }>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { rows, openPorts } = tunnelRows(tunnels, nodeById);

  const rotate = useMutation({
    mutationFn: (pair?: { fromNodeId: string; toNodeId: string }) => rotateCascadeTunnels(cascadeId, pair),
    onSuccess: (_saved, pair) => {
      qc.invalidateQueries({ queryKey: ['cascades'] });
      qc.invalidateQueries({ queryKey: ['cascade-status', cascadeId] });
      notifications.show({
        color: 'green',
        message: pair ? t('cascadeEdit.tunnelRotated') : t('cascadeEdit.tunnelsRotated'),
      });
    },
    onError: (err) => {
      const gone = tunnelNotFound(err);
      if (gone !== null) qc.invalidateQueries({ queryKey: ['cascades'] });
      notifications.show({
        color: 'red',
        title: t('cascadeEdit.tunnelRotateFailed'),
        message: gone !== null ? t('cascadeEdit.tunnelGone') : apiErrorMessage(err),
      });
    },
  });

  if (rows.length === 0) return null;

  const confirm = (row: TunnelRow | null) =>
    modals.openConfirmModal({
      title: row
        ? t('cascadeEdit.tunnelRotateTitle', { from: row.fromName, to: row.toName })
        : t('cascadeEdit.tunnelsRotateTitle', { count: rows.length }),
      children: (
        <Text size="sm">{row ? t('cascadeEdit.tunnelRotateBody') : t('cascadeEdit.tunnelsRotateBody')}</Text>
      ),
      labels: { confirm: t('cascadeEdit.tunnelRotateConfirm'), cancel: t('common.cancel') },
      confirmProps: { color: 'orange' },
      onConfirm: () => rotate.mutate(row ? { fromNodeId: row.fromNodeId, toNodeId: row.toNodeId } : undefined),
    });

  return (
    <Stack gap={12} style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <ShieldIcon size={15} color={MIST} />
        <CardCaption>{t('cascadeEdit.tunnelsTitle')}</CardCaption>
        <Box style={{ flex: 1, minWidth: 0 }} />
        {rows.length > 1 && (
          <SmallAction disabled={rotate.isPending} onClick={() => confirm(null)}>
            {t('cascadeEdit.tunnelsRotateAll')}
          </SmallAction>
        )}
      </Box>

      <Box style={{ borderRadius: 10, backgroundColor: WELL, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <Box
            key={r.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 13px',
              borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}`,
            }}
          >
            <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SNOW }}>
                {r.fromName} → {r.toName}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '13px', color: FAINT }}>
                {r.iface} · {r.network} · {t('cascadeEdit.tunnelPort', { port: r.port })}
              </Text>
            </Stack>
            <SmallAction disabled={rotate.isPending} onClick={() => confirm(r)}>
              {t('cascadeEdit.tunnelRotate')}
            </SmallAction>
          </Box>
        ))}
      </Box>

      {openPorts.map((name) => (
        <Note key={name} tone={AMBER} icon={<WarnIcon size={13} color={AMBER} />}>
          {t('cascadeEdit.tunnelPortOpen', { node: name })}
        </Note>
      ))}

      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
        {t('cascadeEdit.tunnelsHint')}
      </Text>
    </Stack>
  );
}

function SmallAction({ children, disabled, onClick }: { children: string; disabled?: boolean; onClick: () => void }) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 26,
        padding: '0 10px',
        borderRadius: 6,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        fontFamily: DISPLAY,
        fontSize: 11,
        color: MIST,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </UnstyledButton>
  );
}
