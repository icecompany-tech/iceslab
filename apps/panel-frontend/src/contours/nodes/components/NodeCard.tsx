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
  IconRefresh,
  IconRoute,
  IconServer2,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { CoreRestarts } from '@/lib/domain/nodes';
import type { DashboardOverview } from '@/lib/domain/dashboard';
import { countryFlag } from '@/lib/domain/countries';
import { relativeTime } from '@/lib/ui/relativeTime';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
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
  /** T7 - proxy-core version (xray "26.3.27"), null until a versioned agent
   *  reports in. Shown as a small chip so operators can spot nodes too old for
   *  cascade exit selection (needs xray >= 25.9.5). */
  coreVersion?: string | null;
  /** Restart tally + memory headroom of the xray core. null = never reported.
   *  See the CoreHealth block below for why the two are read as one thing. */
  coreRestarts?: CoreRestarts | null;
  /** Only xray reports a tally today, so a missing one is expected news on an
   *  AmneziaWG node and unexpected news on an xray one. Without the protocol
   *  the card would have to print "no data" on every node that will never have
   *  any. */
  protocol?: string;
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
                      fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
                  style={{ color: MIST, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
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
                    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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

        <CoreHealth
          restarts={node.coreRestarts ?? null}
          protocol={node.protocol}
          nodeReachable={!isOffline}
        />

        {node.maxUsers && node.maxUsers > 0 && (
          <Box>
            <Group justify="space-between" mb={2}>
              <Text size="xs" style={{ color: MIST }}>
                {t('nodeCard.loadLabel')}
              </Text>
              <Text
                size="xs"
                style={{ color: SNOW, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
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
                style={{ color: SNOW, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
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
                style={{ color: SNOW, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
              >
                {node.inboundCount} bindings
              </Text>
            </Group>
          </Tooltip>
          {node.coreVersion && (
            <Tooltip label={t('nodeCard.coreVersion')}>
              <Group gap={4} wrap="nowrap" style={{ marginLeft: 'auto' }}>
                <IconCpu size={12} style={{ color: MIST }} />
                <Text
                  size="xs"
                  style={{ color: MIST, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
                >
                  xray {node.coreVersion}
                </Text>
              </Group>
            </Tooltip>
          )}
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

/**
 * The core's restart tally, read as one thought: how often it came back, and
 * how close it runs to the ceiling that will bounce it again.
 *
 * Three things this block refuses to conflate:
 *  - a `null` tally is "nobody told us", not "zero restarts". A node on an old
 *    agent and a node whose core never blinked are opposite news to an
 *    operator, so they must not look alike here.
 *  - a missing ceiling is a watchdog that is OFF, not a ceiling of zero. There
 *    is no bar to draw then, and a bar sitting at 0% would read as "endless
 *    headroom" when the truth is "nothing will catch an OOM".
 *  - `observedAt` is when the panel last WROTE these numbers, not when it last
 *    polled the node. The status cron ticks every 30s but persists only when a
 *    counter moved or RSS drifted more than 10%, so a calm core carries an old
 *    stamp by design. The age is printed as a plain fact and never coloured;
 *    colouring it would flag healthy nodes as stale.
 */
function CoreHealth({
  restarts,
  protocol,
  nodeReachable,
}: {
  restarts: CoreRestarts | null;
  protocol?: string;
  nodeReachable: boolean;
}) {
  const { t } = useTranslation();

  // Only the xray core reports a tally today. On an AmneziaWG node its absence
  // is nothing to say; on an xray node the silence is itself the news.
  if (!restarts) {
    if (protocol !== 'xray') return null;
    return (
      <Tooltip label={t('nodeCard.coreNoDataTip')} withArrow multiline w={280}>
        <Group gap={6} wrap="nowrap">
          <IconRefresh size={12} style={{ color: FAINT }} />
          <Text size="xs" style={{ color: FAINT }}>
            {t('nodeCard.coreNoData')}
          </Text>
        </Group>
      </Tooltip>
    );
  }

  const rss = restarts.rssBytes ?? null;
  const limit = restarts.memoryLimitBytes ?? null;
  // Over 100% is possible: the sample that tripped the watchdog is the one
  // stored, so the bar clamps but the number does not lie.
  const percent = rss !== null && limit ? (rss / limit) * 100 : null;
  const tone = restarts.crash > 0 ? RED : restarts.total > 0 ? AMBER : FAINT;

  const memTip = limit
    ? t('nodeCard.coreMemTip', {
        rss: rss === null ? '-' : formatBytes(rss),
        limit: formatBytes(limit),
      })
    : t('nodeCard.coreMemNoLimitTip', { rss: rss === null ? '-' : formatBytes(rss) });

  const restartTip =
    restarts.total === 0
      ? t('nodeCard.restartsNoneTip')
      : t('nodeCard.restartsTip', {
          crash: restarts.crash,
          memory: restarts.memory,
          when: restarts.lastAt ? relativeTime(restarts.lastAt, t).text : '-',
        });

  const freshness =
    t('nodeCard.coreObservedTip', { at: new Date(restarts.observedAt).toLocaleString() }) +
    (nodeReachable ? '' : ` ${t('nodeCard.coreFrozen')}`);

  // The reason belongs to the LAST restart, so it is only appended when the
  // agent actually named one. Defaulting a missing reason to "crash" would
  // invent a bug report out of a blank field.
  const restartLine =
    restarts.total === 0
      ? t('nodeCard.restartsNone')
      : [
          t('nodeCard.restarts', { count: restarts.total }),
          restarts.lastReason === 'memory'
            ? t('nodeCard.reasonMemory')
            : restarts.lastReason
              ? t('nodeCard.reasonCrash')
              : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <Stack gap={4}>
      <Tooltip label={memTip} withArrow multiline w={280}>
        <Box>
          <Group gap={6} mb={2} wrap="nowrap">
            <Box style={{ color: tone, display: 'flex' }}>
              <IconRefresh size={12} />
            </Box>
            <Text
              size="xs"
              fw={500}
              style={{
                color: MIST,
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              CORE
            </Text>
            <Text
              size="xs"
              truncate
              style={{
                flex: 1,
                minWidth: 0,
                color: FAINT,
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 10,
              }}
            >
              {rss === null
                ? t('nodeCard.coreNoRss')
                : limit
                  ? `${formatBytes(rss)} / ${formatBytes(limit)}`
                  : `${formatBytes(rss)} · ${t('nodeCard.coreNoLimit')}`}
            </Text>
            <Text
              size="xs"
              fw={600}
              style={{ color: percent === null ? FAINT : SNOW, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
            >
              {percent === null ? '-' : `${percent.toFixed(0)}%`}
            </Text>
          </Group>
          {/* No ceiling, no bar. An empty track would read as "0% used, plenty
              of room" when the truth is that nothing is measuring the room. */}
          {percent !== null && (
            <Progress
              value={Math.min(100, percent)}
              size="xs"
              radius="xs"
              styles={{
                root: { backgroundColor: HAIRLINE },
                section: { backgroundColor: thresholdColor(percent) },
              }}
            />
          )}
        </Box>
      </Tooltip>

      <Group justify="space-between" gap={6} wrap="nowrap">
        <Tooltip label={restartTip} withArrow multiline w={280}>
          <Text
            size="xs"
            truncate
            style={{ color: tone, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 10 }}
          >
            {restartLine}
          </Text>
        </Tooltip>
        <Tooltip label={freshness} withArrow multiline w={280}>
          <Text
            size="xs"
            style={{ color: FAINT, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 10, flexShrink: 0 }}
          >
            {relativeTime(restarts.observedAt, t).text}
          </Text>
        </Tooltip>
      </Group>
    </Stack>
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
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
            style={{ color: SNOW, fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace" }}
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
