import { Caption } from '@/contours/nodes/components/NodeEdit/Caption';
import { ChipIcon, DbIcon, DiskIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { Divider } from '@/contours/nodes/components/NodeEdit/Separators';
import { ExposureNote } from '@/contours/nodes/components/NodeEdit/ExposureNote';
import { FactRow } from '@/contours/nodes/components/NodeEdit/FactRow';
import { Meter } from '@/contours/nodes/components/NodeEdit/Meter';
import { PlainButton } from '@/contours/nodes/components/NodeEdit/PlainButton';
import { formatBytes, uptime } from '@/contours/nodes/lib/nodeFormat';
import { Box, Stack, Text } from '@mantine/core';
import { CARD, CYAN, DISPLAY, HAIRLINE, MIST, MONO, MOSS, WELL } from '@/contours/nodes/lib/colors';
import { useTranslation } from 'react-i18next';
import type { NodeEditor } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';

/**
 * What the box reports about itself: uptime, load, disk, core versions.
 * Read-only.
 */
export function SystemPanel({
  hostsQuery,
  dashNode,
  metrics,
  exposureMutation,
}: Pick<NodeEditor, 'hostsQuery' | 'dashNode' | 'metrics' | 'exposureMutation'>) {
  const { t } = useTranslation();

  return (
    <>
            {/* System: what the box reports about itself. Read-only. */}
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
              <Stack
                gap={14}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <ChipIcon size={15} color={CYAN} />
                  <Caption>{t('nodeEdit.systemTitle')}</Caption>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  {metrics && (
                    <Box
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 20,
                        paddingInline: 8,
                        borderRadius: 5,
                        backgroundColor: WELL,
                        border: `1px solid ${HAIRLINE}`,
                      }}
                    >
                      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: MIST }}>
                        {t('nodeEdit.uptime', { value: uptime(metrics.uptimeSeconds) })}
                      </Text>
                    </Box>
                  )}
                </Box>

                <Stack gap={10}>
                  <Meter
                    icon={<ChipIcon size={12} color={MOSS} />}
                    label="CPU"
                    detail={
                      metrics?.cpu
                        ? t('nodeEdit.cpuDetail', {
                            cores: metrics.cpu.cores,
                            la: `${metrics.cpu.loadAvg1.toFixed(2)} / ${metrics.cpu.loadAvg5.toFixed(2)} / ${metrics.cpu.loadAvg15.toFixed(2)}`,
                          })
                        : '-'
                    }
                    percent={metrics?.cpu?.usagePercent ?? null}
                  />
                  <Meter
                    icon={<DbIcon size={12} color={MOSS} />}
                    label="RAM"
                    detail={
                      metrics?.memory
                        ? `${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`
                        : '-'
                    }
                    percent={metrics?.memory?.usedPercent ?? null}
                  />
                  <Meter
                    icon={<DiskIcon size={12} color={MOSS} />}
                    label="DISK"
                    detail={
                      metrics?.disk
                        ? `${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}`
                        : '-'
                    }
                    percent={metrics?.disk?.usedPercent ?? null}
                  />
                </Stack>

                <Divider />
                <FactRow label={t('nodeEdit.today')} value={formatBytes(dashNode?.todayBytes ?? 0)} />
                <FactRow label={t('nodeEdit.hosts')} value={String(hostsQuery.data?.hosts.length ?? 0)} />
                <FactRow
                  label={t('nodeEdit.userReach')}
                  value={dashNode ? `~${dashNode.inboundCount}` : '-'}
                />
                <Divider />

                <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1 }}>
                    {t('nodeEdit.exposure')}
                  </Text>
                  <PlainButton
                    icon="shield"
                    strong
                    height={30}
                    disabled={exposureMutation.isPending}
                    onClick={() => exposureMutation.mutate()}
                  >
                    {t('nodeEdit.exposureCheck')}
                  </PlainButton>
                </Box>
                {exposureMutation.data && <ExposureNote result={exposureMutation.data} />}
              </Stack>
            </Box>
    </>
  );
}
