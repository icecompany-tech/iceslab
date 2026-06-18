import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Group,
  Menu,
  Progress,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconKey,
  IconRoute,
  IconServer2,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { DashboardOverview } from '../lib/api';
import { countryFlag } from '../lib/countries';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

type DashboardNode = DashboardOverview['nodes'][number];

interface CardNode {
  id: string;
  name: string;
  status: string;
  countryCode: string | null;
  regionLabel: string | null;
  maxUsers: number | null;
  approxUsers: number;
  lastStatusChange: string | null;
  inboundCount: number;
  todayBytes: number;
  metrics: DashboardNode['metrics'];
  rawId: string;
  address: string;
  /** When this node is a hop in a cascade: "<cascade name> · <role>" for the
   *  chain badge. Null when the node is standalone. */
  cascadeLabel?: string | null;
}

interface Props {
  node: CardNode;
  onEdit: () => void;
  onDelete: () => void;
  onRefreshBootstrap: () => void;
  refreshLoading?: boolean;
}

function statusAccent(status: string): string {
  if (status === 'online') return MOSS;
  if (status === 'disabled' || status === 'unknown') return MIST;
  if (status === 'degraded') return AMBER;
  return RED;
}

function thresholdColor(p: number): string {
  if (p > 85) return RED;
  if (p > 60) return AMBER;
  return MOSS;
}

export function NodeCard({
  node,
  onEdit,
  onDelete,
  onRefreshBootstrap,
  refreshLoading,
}: Props) {
  const { t } = useTranslation();
  const m = node.metrics;
  const accent = statusAccent(node.status);
  const isOffline = node.status === 'offline' || node.status === 'unreachable';
  const isDegraded = node.status === 'degraded';

  const bgTint = isOffline
    ? `linear-gradient(180deg, ${RED}0D 0%, ${CARD} 60%)`
    : isDegraded
      ? `linear-gradient(180deg, ${AMBER}0D 0%, ${CARD} 60%)`
      : CARD;

  const borderColor = isOffline ? `${RED}55` : isDegraded ? `${AMBER}55` : HAIRLINE;

  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={{
        position: 'relative',
        background: bgTint,
        borderColor,
        borderTopWidth: 3,
        borderTopColor: accent,
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Box style={{ position: 'relative' }}>
              <IconServer2 size={20} style={{ color: MIST }} />
              {node.status === 'online' && (
                <Box
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: MOSS,
                    boxShadow: `0 0 8px ${MOSS}99`,
                    border: `2px solid ${GROUND}`,
                    animation: 'iceslab-pulse 2s ease-in-out infinite',
                  }}
                />
              )}
            </Box>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Group gap={6} wrap="nowrap">
                {node.countryCode && (
                  <Text size="md" lh={1}>
                    {countryFlag(node.countryCode)}
                  </Text>
                )}
                <Text fw={600} size="sm" truncate style={{ color: SNOW }}>
                  {node.name}
                </Text>
                {node.regionLabel && (
                  <Badge
                    size="xs"
                    variant="light"
                    style={{
                      backgroundColor: `${CYAN}1A`,
                      color: CYAN,
                      border: `1px solid ${CYAN}33`,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      fontFamily: "'Geist Mono', monospace",
                      letterSpacing: '0.08em',
                    }}
                  >
                    {node.regionLabel}
                  </Badge>
                )}
              </Group>
              <Tooltip label={node.address} withArrow openDelay={300} position="bottom-start">
                <Text
                  size="xs"
                  truncate
                  style={{ color: MIST, fontFamily: "'Geist Mono', monospace" }}
                >
                  {node.address}
                </Text>
              </Tooltip>
              {node.cascadeLabel && (
                <Badge
                  size="xs"
                  variant="light"
                  leftSection={<IconRoute size={10} />}
                  style={{
                    marginTop: 4,
                    alignSelf: 'flex-start',
                    maxWidth: '100%',
                    backgroundColor: `${VIOLET}1A`,
                    color: VIOLET,
                    border: `1px solid ${VIOLET}33`,
                    textTransform: 'none',
                    fontFamily: "'Geist Mono', monospace",
                  }}
                >
                  {node.cascadeLabel}
                </Badge>
              )}
            </Stack>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Badge
              variant="light"
              size="sm"
              style={{
                backgroundColor: `${accent}1A`,
                color: accent,
                border: `1px solid ${accent}33`,
                textTransform: 'uppercase',
                fontFamily: "'Geist Mono', monospace",
                letterSpacing: '0.08em',
              }}
            >
              {node.status}
            </Badge>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" size="sm" style={{ color: MIST }}>
                  <IconDotsVertical size={14} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
                <Menu.Item
                  leftSection={<IconKey size={14} />}
                  onClick={onRefreshBootstrap}
                  disabled={refreshLoading}
                >
                  {t('nodeCard.reBootstrap')}
                </Menu.Item>
                <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
                  {t('common.edit')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>
                  {t('common.delete')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        {m ? (
          <Stack gap={6}>
            <MetricBar
              icon={<IconCpu size={12} />}
              label="CPU"
              value={m.cpu.usagePercent}
              tooltip={`${m.cpu.cores} cores · LA ${m.cpu.loadAvg1.toFixed(2)} / ${m.cpu.loadAvg5.toFixed(2)} / ${m.cpu.loadAvg15.toFixed(2)}`}
            />
            <MetricBar
              icon={<IconDatabase size={12} />}
              label="RAM"
              value={m.memory.usedPercent}
              tooltip={`${formatBytes(m.memory.usedBytes)} / ${formatBytes(m.memory.totalBytes)}`}
            />
            <MetricBar
              icon={<IconDeviceFloppy size={12} />}
              label="Disk"
              value={m.disk.usedPercent}
              tooltip={`${formatBytes(m.disk.usedBytes)} / ${formatBytes(m.disk.totalBytes)}`}
            />
          </Stack>
        ) : (
          <Box
            py="xs"
            px="sm"
            style={{
              borderRadius: 6,
              background: GROUND,
              border: `1px solid ${HAIRLINE}`,
              textAlign: 'center',
            }}
          >
            <Text size="xs" style={{ color: MIST }}>
              {t('nodeCard.metricsPending')}
            </Text>
          </Box>
        )}

        {node.maxUsers && node.maxUsers > 0 && (
          <Box>
            <Group justify="space-between" mb={2}>
              <Text size="xs" style={{ color: MIST }}>
                {t('nodeCard.loadLabel')}
              </Text>
              <Text
                size="xs"
                style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}
              >
                {node.approxUsers}/{node.maxUsers}
              </Text>
            </Group>
            <Progress
              value={Math.min(100, Math.round((node.approxUsers / node.maxUsers) * 100))}
              size="xs"
              styles={{
                root: { backgroundColor: HAIRLINE },
                section: {
                  backgroundColor:
                    node.approxUsers >= node.maxUsers
                      ? RED
                      : node.approxUsers / node.maxUsers > 0.85
                        ? AMBER
                        : MOSS,
                },
              }}
            />
          </Box>
        )}

        <Group gap="sm" wrap="nowrap" pt={2} style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <Tooltip label="Traffic today">
            <Group gap={4} wrap="nowrap">
              <IconDownload size={12} style={{ color: CYAN }} />
              <Text
                size="xs"
                style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}
              >
                {formatBytes(node.todayBytes)}
              </Text>
            </Group>
          </Tooltip>
          <Tooltip label="Inbound bindings on this node">
            <Group gap={4} wrap="nowrap">
              <IconUpload size={12} style={{ color: VIOLET }} />
              <Text
                size="xs"
                style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}
              >
                {node.inboundCount} bindings
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </Stack>

      <style>{`
        @keyframes iceslab-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.3); }
        }
      `}</style>
    </Card>
  );
}

function MetricBar({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tooltip: string;
}) {
  const color = thresholdColor(value);
  return (
    <Tooltip label={tooltip} withArrow>
      <Box>
        <Group gap={6} mb={2} wrap="nowrap">
          <Box style={{ color, display: 'flex' }}>{icon}</Box>
          <Text
            size="xs"
            fw={500}
            style={{
              flex: 1,
              color: MIST,
              fontFamily: "'Geist Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </Text>
          <Text
            size="xs"
            fw={600}
            style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}
          >
            {value.toFixed(0)}%
          </Text>
        </Group>
        <Progress
          value={value}
          size="xs"
          radius="xs"
          styles={{
            root: { backgroundColor: HAIRLINE },
            section: { backgroundColor: color },
          }}
        />
      </Box>
    </Tooltip>
  );
}

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
