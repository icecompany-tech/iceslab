import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconKey,
  IconRoute,
  IconServer2,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { countryFlag } from '../lib/countries';
import { MIN_CASCADE_CORE, isOlderThan } from '../lib/protocols';

/**
 * One VPS, as the fleet reads it: is it up, how loaded is it, what does it
 * carry, and can it still do the job (core version). Written against the
 * artboard rather than grown from the old card, so the vertical rhythm and the
 * metric rows match the design exactly.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';
const CYAN = '#7DD3FC';

const DISPLAY = "'Space Grotesk Variable', 'Space Grotesk', 'Inter Variable', Inter, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export interface FleetNode {
  id: string;
  name: string;
  address: string;
  status: string;
  countryCode: string | null;
  coreVersion: string | null;
  maxUsers: number | null;
  approxUsers: number;
  hostCount: number;
  todayBytes: number;
  uptimeSeconds: number | null;
  cascadeLabel: string | null;
  egressLabel: string | null;
  metrics: {
    cpu: { usagePercent: number; cores: number; loadAvg1: number } | null;
    memory: { usedBytes: number; totalBytes: number; usedPercent: number } | null;
    disk: { usedBytes: number; totalBytes: number; usedPercent: number } | null;
  };
}

export function NodeFleetCard({
  node,
  onEdit,
  onDelete,
  onRefreshBootstrap,
}: {
  node: FleetNode;
  onEdit: () => void;
  onDelete: () => void;
  onRefreshBootstrap: () => void;
}) {
  const { t } = useTranslation();
  const accent = statusAccent(node.status);
  const coreTooOld = isOlderThan(node.coreVersion, MIN_CASCADE_CORE);

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        borderTop: `3px solid ${accent}`,
      }}
    >
      {/* Identity: flag, name, and whether it is answering right now. */}
      <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Box style={{ color: MIST, display: 'flex', marginTop: 2 }}>
          <IconServer2 size={16} stroke={1.8} />
        </Box>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {node.countryCode && <Text style={{ fontSize: 14 }}>{countryFlag(node.countryCode)}</Text>}
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 15,
                fontWeight: 600,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node.name}
            </Text>
          </Box>
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: MIST,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {node.address}
          </Text>
        </Stack>

        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 20,
            padding: '0 8px',
            borderRadius: 5,
            backgroundColor: `${accent}1A`,
            border: `1px solid ${accent}33`,
            flexShrink: 0,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', color: accent }}>
            {node.status.toUpperCase()}
          </Text>
        </Box>

        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <UnstyledButton style={{ display: 'flex', color: DIM, flexShrink: 0, marginTop: 2 }}>
              <IconDotsVertical size={14} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
              {t('common.edit')}
            </Menu.Item>
            <Menu.Item leftSection={<IconKey size={14} />} onClick={onRefreshBootstrap}>
              {t('nodes.refreshBootstrap')}
            </Menu.Item>
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
              {t('common.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>

      {/* Role in a cascade, or where its traffic leaves. Only when it applies. */}
      {(node.cascadeLabel || node.egressLabel) && (
        <Box style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {node.cascadeLabel && (
            <RoleChip accent={VIOLET} icon={<IconRoute size={11} stroke={1.8} />}>
              {node.cascadeLabel}
            </RoleChip>
          )}
          {node.egressLabel && (
            <RoleChip accent={CYAN} icon={<IconSettings size={11} stroke={1.8} />}>
              {node.egressLabel}
            </RoleChip>
          )}
        </Box>
      )}

      <Stack gap={8}>
        <MetricRow
          icon={<IconCpu size={12} stroke={1.8} />}
          label="CPU"
          detail={
            node.metrics.cpu
              ? t('nodeCard.cpuDetail', {
                  cores: node.metrics.cpu.cores,
                  la: node.metrics.cpu.loadAvg1.toFixed(2),
                })
              : null
          }
          percent={node.metrics.cpu?.usagePercent ?? null}
        />
        <MetricRow
          icon={<IconDatabase size={12} stroke={1.8} />}
          label="RAM"
          detail={
            node.metrics.memory
              ? `${formatBytes(node.metrics.memory.usedBytes)} / ${formatBytes(node.metrics.memory.totalBytes)}`
              : null
          }
          percent={node.metrics.memory?.usedPercent ?? null}
        />
        <MetricRow
          icon={<IconServer2 size={12} stroke={1.8} />}
          label="DISK"
          detail={
            node.metrics.disk
              ? `${formatBytes(node.metrics.disk.usedBytes)} / ${formatBytes(node.metrics.disk.totalBytes)}`
              : null
          }
          percent={node.metrics.disk?.usedPercent ?? null}
        />
      </Stack>

      {/* Capacity, or the one thing standing between this node and its job. */}
      {coreTooOld ? (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 6,
            backgroundColor: `${AMBER}14`,
            border: `1px solid ${AMBER}3D`,
          }}
        >
          <IconAlertTriangle size={12} color={AMBER} />
          <Text style={{ fontSize: 11, color: AMBER }}>
            {t('nodeCard.coreTooOld', { min: MIN_CASCADE_CORE })}
          </Text>
        </Box>
      ) : node.maxUsers === null ? (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 6,
            backgroundColor: WELL,
          }}
        >
          <IconAlertTriangle size={12} color={FAINT} />
          <Text style={{ fontSize: 11, color: FAINT }}>{t('nodeCard.noCap')}</Text>
        </Box>
      ) : (
        <Stack gap={5}>
          <Box style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: FAINT }}>
              {t('nodeCard.load')}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 11, color: SNOW }}>
              {node.approxUsers} / {node.maxUsers}
            </Text>
          </Box>
          <Bar percent={(node.approxUsers / Math.max(1, node.maxUsers)) * 100} color={CYAN} />
        </Stack>
      )}

      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          paddingTop: 10,
          borderTop: `1px solid ${HAIRLINE}`,
          flexWrap: 'wrap',
        }}
      >
        <Foot icon={<IconDownload size={12} stroke={1.8} />}>{formatBytes(node.todayBytes)}</Foot>
        <Foot icon={<IconRoute size={12} stroke={1.8} />}>
          {t('nodeCard.hosts', { count: node.hostCount })}
        </Foot>
        <Box style={{ flex: 1 }} />
        {node.uptimeSeconds !== null && (
          <Foot icon={<IconClock size={12} stroke={1.8} />}>{formatUptime(node.uptimeSeconds)}</Foot>
        )}
        {node.coreVersion && (
          <Foot icon={<IconSettings size={12} stroke={1.8} />} accent={coreTooOld ? AMBER : undefined}>
            xray {node.coreVersion}
          </Foot>
        )}
      </Box>
    </Box>
  );
}

function MetricRow({
  icon,
  label,
  detail,
  percent,
}: {
  icon: ReactNode;
  label: string;
  detail: string | null;
  percent: number | null;
}) {
  const color = percent === null ? DIM : thresholdColor(percent);
  return (
    <Stack gap={4}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Box style={{ color: FAINT, display: 'flex' }}>{icon}</Box>
        <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: MIST }}>
          {label}
        </Text>
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 10,
            color: FAINT,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {detail ?? ''}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color }}>
          {percent === null ? '-' : `${percent.toFixed(0)}%`}
        </Text>
      </Box>
      <Bar percent={percent ?? 0} color={color} />
    </Stack>
  );
}

function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <Box style={{ height: 3, borderRadius: 2, backgroundColor: HAIRLINE, overflow: 'hidden' }}>
      <Box
        style={{
          height: 3,
          borderRadius: 2,
          backgroundColor: color,
          width: `${Math.min(100, Math.max(0, percent))}%`,
        }}
      />
    </Box>
  );
}

function RoleChip({
  accent,
  icon,
  children,
}: {
  accent: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 6,
        backgroundColor: `${accent}14`,
        border: `1px solid ${accent}33`,
      }}
    >
      <Box style={{ color: accent, display: 'flex' }}>{icon}</Box>
      <Text style={{ fontFamily: MONO, fontSize: 10, color: accent }}>{children}</Text>
    </Box>
  );
}

function Foot({
  icon,
  accent,
  children,
}: {
  icon: ReactNode;
  accent?: string;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Box style={{ color: accent ?? FAINT, display: 'flex' }}>{icon}</Box>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: accent ?? MIST }}>{children}</Text>
    </Box>
  );
}

function statusAccent(status: string): string {
  if (status === 'online') return MOSS;
  if (status === 'degraded') return AMBER;
  if (status === 'disabled' || status === 'unknown') return MIST;
  return RED;
}

function thresholdColor(p: number): string {
  if (p > 85) return RED;
  if (p > 60) return AMBER;
  return MOSS;
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(sec: number): string {
  if (sec < 3600) return `up ${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `up ${Math.floor(sec / 3600)}h`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `up ${d}d ${String(h).padStart(2, '0')}h`;
}
