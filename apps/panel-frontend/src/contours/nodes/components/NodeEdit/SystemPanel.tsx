import { Caption } from '@/contours/nodes/components/NodeEdit/Caption';
import { ChipIcon, DbIcon, DiskIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { Divider } from '@/contours/nodes/components/NodeEdit/Separators';
import { ExposureNote } from '@/contours/nodes/components/NodeEdit/ExposureNote';
import { FactRow } from '@/contours/nodes/components/NodeEdit/FactRow';
import { Meter } from '@/contours/nodes/components/NodeEdit/Meter';
import { PlainButton } from '@/contours/nodes/components/NodeEdit/PlainButton';
import { bytesOrDash, countOrDash, formatBytes, uptime } from '@/contours/nodes/lib/nodeFormat';
import { Box, Stack, Text } from '@mantine/core';
import { CARD, CYAN, DISPLAY, HAIRLINE, MIST, MONO, MOSS, WELL } from '@/contours/nodes/lib/colors';
import { useTranslation } from 'react-i18next';
import type { NodeEditor } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';
import type { Node } from '@/lib/domain/nodes';
import { CertRow } from '@/contours/nodes/components/NodeEdit/CertRow';
import { ConnLogBlock } from '@/contours/nodes/components/NodeEdit/ConnLogBlock';
import { LingeringBlock } from '@/contours/nodes/components/NodeEdit/LingeringBlock';
import { confirmCertRotate } from '@/contours/nodes/components/nodeConfirm';
import { certTerm } from '@/contours/nodes/lib/nodeCert';
import { useNow } from '@/lib/ui/useNow';

/**
 * What the box reports about itself: uptime, load, disk, core versions.
 * Read-only.
 */
export function SystemPanel({
  node,
  hostsQuery,
  dashNode,
  metrics,
  exposureMutation,
  certMutation,
}: Pick<NodeEditor, 'hostsQuery' | 'dashNode' | 'metrics' | 'exposureMutation' | 'certMutation'> & {
  node: Pick<Node, 'id' | 'name' | 'certNotAfter' | 'agentCanRotate'>;
}) {
  const { t } = useTranslation();
  // After a renewal the page shows the end the server just gave, until the
  // node query brings the same back.
  const now = useNow(60_000);
  const certNotAfter = certMutation.data?.notAfter ?? node.certNotAfter;
  const cert = certTerm(certNotAfter, now);

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
                {/* No overview: «-», not «0 B» (bytesOrDash). */}
                <FactRow label={t('nodeEdit.today')} value={bytesOrDash(dashNode?.todayBytes)} />
                {/* «-» without the list: «0 hosts» over a failed request is a claim (A-141). */}
                <FactRow label={t('nodeEdit.hosts')} value={hostsQuery.data ? String(hostsQuery.data.hosts.length) : '-'} />
                {/* A-261: the overview's inboundCount is the node's bindings
                    (dashboard.service `_count.profileBindings`), said as such; it
                    was labelled «user reach», which the answer does not carry. */}
                <FactRow label={t('nodeEdit.bindings')} value={countOrDash(dashNode?.inboundCount)} />
                {/* A-218: taken off, but a connection opened before is still live. */}
                <LingeringBlock nodeId={node.id} />
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
                {cert && (
                  <>
                    <Divider />
                    <CertRow
                      term={cert}
                      // A renewal that went through proves the agent can.
                      agentCanRotate={certMutation.data ? true : node.agentCanRotate}
                      onRotate={() => confirmCertRotate(node, t, () => certMutation.mutate())}
                      rotating={certMutation.isPending}
                      rotated={certMutation.data?.notAfter ?? null}
                      error={certMutation.error}
                    />
                  </>
                )}
                {/* Clients' addresses in the machine's logs, checked on request. */}
                <Divider />
                <ConnLogBlock node={node} />
              </Stack>
            </Box>
    </>
  );
}
