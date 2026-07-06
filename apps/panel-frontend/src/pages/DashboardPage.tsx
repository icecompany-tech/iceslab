import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { now } from '../lib/demoFlag';
import {
  Badge,
  Box,
  Card,
  Group,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { useOverview } from '../hooks/useOverview';
import {
  IconActivity,
  IconArrowDownRight,
  IconArrowUpRight,
  IconChartArea,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDeviceDesktopAnalytics,
  IconNetwork,
  IconServer2,
  IconTrendingUp,
  IconUserCheck,
  IconUsers,
  IconWifi,
} from '@tabler/icons-react';
import { type DashboardOverview } from '../lib/api';
import { PageHero } from '../components/PageHero';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

const MONO_LABEL = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

const DISPLAY = {
  fontFamily: "'Space Grotesk', Inter, sans-serif",
};

const cardStyle = {
  backgroundColor: CARD,
  borderColor: HAIRLINE,
};

const NODE_STATUS_COLOR: Record<string, string> = {
  online: MOSS,
  offline: RED,
  unreachable: RED,
  unknown: MIST,
  disabled: MIST,
  degraded: AMBER,
};

const EVENT_COLOR: Record<string, string> = {
  'user.created': MOSS,
  'user.updated': CYAN,
  'user.deleted': RED,
  'user.status-changed': AMBER,
};

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function splitBytes(n: number): { value: string; unit: string } {
  if (n === 0) return { value: '0', unit: 'B' };
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  const value = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return { value, unit: units[i] };
}

function formatDelta(
  value: number,
  base: number,
): { text: string; positive: boolean; noData: boolean } {
  // No traffic yet on either side, empty deltas like "0 B vs yesterday" read
  // weird and break in two lines on narrow viewports. Signal "no data" so the
  // hint can show a friendlier placeholder.
  if (value === 0 && base === 0) return { text: '', positive: true, noData: true };
  if (base === 0) return { text: formatBytes(value), positive: value >= 0, noData: false };
  const delta = value - base;
  const sign = delta >= 0 ? '+' : '−';
  return { text: `${sign}${formatBytes(Math.abs(delta))}`, positive: delta >= 0, noData: false };
}

function relativeTime(iso: string): string {
  const diffMs = now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function thresholdColor(p: number, warn = 60, crit = 85): string {
  if (p > crit) return RED;
  if (p > warn) return AMBER;
  return MOSS;
}

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  hintColor?: string;
  accent: string;
}

function StatCard({ icon, label, value, unit, hint, hintColor = MIST, accent }: StatCardProps) {
  return (
    <Card withBorder padding="md" radius="md" style={cardStyle}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb={10}>
        <Text style={MONO_LABEL}>{label}</Text>
        <Box style={{ color: accent, display: 'flex', flexShrink: 0 }}>{icon}</Box>
      </Group>
      <Group gap={6} align="baseline" wrap="nowrap" mb={hint ? 8 : 0}>
        <Text
          style={{ ...DISPLAY, fontSize: 52, fontWeight: 500, color: SNOW, lineHeight: 1 }}
        >
          {value}
        </Text>
        {unit && (
          <Text
            style={{ ...DISPLAY, fontSize: 22, fontWeight: 400, color: MIST, lineHeight: 1 }}
          >
            {unit}
          </Text>
        )}
      </Group>
      {hint && (
        <Text
          style={{
            ...MONO_LABEL,
            fontSize: 9,
            letterSpacing: '0.14em',
            color: hintColor,
          }}
        >
          {hint}
        </Text>
      )}
    </Card>
  );
}

function Sparkline({ data, height = 110 }: { data: { hour: string; bytes: number }[]; height?: number }) {
  const { t } = useTranslation();
  if (data.length < 2) {
    return (
      <Group justify="center" h={height}>
        <Text size="sm" style={{ color: MIST }}>
          {t('dashboard.traffic.noChartData')}
        </Text>
      </Group>
    );
  }
  const max = Math.max(...data.map((d) => d.bytes), 1);
  const w = 800;
  const h = height;
  const stepX = w / (data.length - 1);
  const pts = data.map((d, i) => `${(i * stepX).toFixed(1)},${(h - (d.bytes / max) * (h - 8) - 4).toFixed(1)}`);
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${w},${h} L 0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.45" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkGrad)" />
      <path d={line} fill="none" stroke={CYAN} strokeWidth={2} />
    </svg>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useOverview();

  if (isLoading) {
    return (
      <Stack>
        <Title order={2}>{t('dashboard.title')}</Title>
        <Text style={{ color: MIST }}>{t('common.loading')}</Text>
      </Stack>
    );
  }
  if (isError || !data) {
    return (
      <Stack>
        <Title order={2}>{t('dashboard.title')}</Title>
        <Text style={{ color: RED }}>{t('dashboard.health.noData')}</Text>
      </Stack>
    );
  }

  return <DashboardContent data={data} />;
}

function DashboardContent({ data }: { data: DashboardOverview }) {
  const { t } = useTranslation();
  const { users, traffic, system, nodes, byProtocol, topUsersToday, recentEvents } = data;
  const todayDelta = formatDelta(traffic.todayBytes, traffic.yesterdayBytes);
  const todaySplit = splitBytes(traffic.todayBytes);

  const nowDate = new Date(now());
  const timeLabel = nowDate.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).toUpperCase();
  const heroHeadline =
    users.onlineNow <= users.total * 0.3
      ? t('pageHero.dashboardHeadlineQuiet')
      : users.onlineNow >= users.total * 0.7
        ? t('pageHero.dashboardHeadlineBusy')
        : t('pageHero.dashboardHeadlineSteady');

  return (
    <Stack gap="lg">
      <PageHero
        eyebrow={t('pageHero.dashboardEyebrow', { time: timeLabel })}
        title={heroHeadline}
        subtitle={t('pageHero.dashboardSubtitle', {
          nodes: system.onlineNodeCount,
          users: users.byStatus.active ?? 0,
        })}
      />

      {/* Hero row */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          icon={<IconWifi size={20} />}
          accent={MOSS}
          label={t('dashboard.hero.onlineNow')}
          value={`${users.onlineNow}`}
          hint={t('dashboard.hero.onlineHint', {
            today: users.onlineToday,
            week: users.onlineThisWeek,
          })}
        />
        <StatCard
          icon={<IconChartArea size={20} />}
          accent={CYAN}
          label={t('dashboard.hero.trafficToday')}
          value={todaySplit.value}
          unit={todaySplit.unit}
          hint={
            todayDelta.noData
              ? t('dashboard.hero.trafficNoData')
              : t('dashboard.hero.trafficVsYesterday', { delta: todayDelta.text })
          }
          hintColor={todayDelta.positive ? MOSS : RED}
        />
        <StatCard
          icon={<IconUserCheck size={20} />}
          accent={VIOLET}
          label={t('dashboard.hero.activeUsers')}
          value={`${users.byStatus.active ?? 0}`}
          hint={t('dashboard.hero.ofTotal', { total: users.total })}
        />
        <StatCard
          icon={<IconServer2 size={20} />}
          accent={system.onlineNodeCount === system.totalNodeCount ? MOSS : AMBER}
          label={t('dashboard.hero.nodesOnline')}
          value={`${system.onlineNodeCount}`}
          unit={`/ ${system.totalNodeCount}`}
          hint={
            system.onlineNodeCount === system.totalNodeCount
              ? t('dashboard.hero.allNodesUp')
              : t('dashboard.hero.someNodesDown')
          }
          hintColor={system.onlineNodeCount === system.totalNodeCount ? MOSS : AMBER}
        />
      </SimpleGrid>

      {/* Traffic sparkline */}
      <Card withBorder padding="lg" radius="md" style={cardStyle}>
        <Group justify="space-between" mb="xs" wrap="wrap">
          <Group gap="xs">
            <ThemeIcon
              size={28}
              radius="md"
              variant="light"
              style={{ backgroundColor: `${CYAN}1A`, color: CYAN, border: `1px solid ${CYAN}33` }}
            >
              <IconTrendingUp size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={600} style={{ color: SNOW }}>
                {t('dashboard.traffic.title')}
              </Text>
              <Text size="xs" style={{ color: MIST }}>
                {t('dashboard.traffic.subtitle')}
              </Text>
            </Stack>
          </Group>
          <Group gap="lg">
            <TrafficStat
              label={t('dashboard.traffic.labels.today')}
              value={formatBytes(traffic.todayBytes)}
              delta={formatDelta(traffic.todayBytes, traffic.yesterdayBytes)}
            />
            <TrafficStat
              label={t('dashboard.traffic.labels.week')}
              value={formatBytes(traffic.last7dBytes)}
              delta={formatDelta(traffic.last7dBytes, traffic.prev7dBytes)}
            />
            <TrafficStat
              label={t('dashboard.traffic.labels.d30')}
              value={formatBytes(traffic.last30dBytes)}
              delta={formatDelta(traffic.last30dBytes, traffic.prev30dBytes)}
            />
            <TrafficStat
              label={t('dashboard.traffic.labels.month')}
              value={formatBytes(traffic.calendarMonthBytes)}
              delta={formatDelta(traffic.calendarMonthBytes, traffic.lastCalendarMonthBytes)}
            />
            <TrafficStat
              label={t('dashboard.traffic.labels.year')}
              value={formatBytes(traffic.currentYearBytes)}
              delta={formatDelta(traffic.currentYearBytes, traffic.lastYearBytes)}
            />
          </Group>
        </Group>
        <Sparkline data={traffic.last24hHourly} />
      </Card>

      {/* User status breakdown */}
      <Card withBorder padding="lg" radius="md" style={cardStyle}>
        <Group gap="xs" mb="md">
          <ThemeIcon
            size={28}
            radius="md"
            variant="light"
            style={{ backgroundColor: `${VIOLET}1A`, color: VIOLET, border: `1px solid ${VIOLET}33` }}
          >
            <IconUsers size={16} />
          </ThemeIcon>
          <Text fw={600} style={{ color: SNOW }}>
            {t('dashboard.userStatus.title')}
          </Text>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
          <StatusChip label={t('dashboard.userStatus.total')} value={users.total} dot={CYAN} />
          <StatusChip label={t('dashboard.userStatus.active')} value={users.byStatus.active ?? 0} dot={MOSS} />
          <StatusChip label={t('dashboard.userStatus.expired')} value={users.byStatus.expired ?? 0} dot={RED} />
          <StatusChip label={t('dashboard.userStatus.limited')} value={users.byStatus.limited ?? 0} dot={AMBER} />
          <StatusChip label={t('dashboard.userStatus.disabled')} value={users.byStatus.disabled ?? 0} dot={MIST} />
        </SimpleGrid>
      </Card>

      {/* Host system metrics */}
      <SystemHealth host={data.host} />

      {/* Two-column row: nodes + protocols */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder padding="lg" radius="md" style={cardStyle}>
          <Group gap="xs" mb="md">
            <ThemeIcon
              size={28}
              radius="md"
              variant="light"
              style={{ backgroundColor: `${CYAN}1A`, color: CYAN, border: `1px solid ${CYAN}33` }}
            >
              <IconServer2 size={16} />
            </ThemeIcon>
            <Text fw={600} style={{ color: SNOW }}>
              {t('dashboard.nodes.title')}
            </Text>
            <Badge variant="light" color="gray" style={{ backgroundColor: `${MIST}1A`, color: MIST }}>
              {nodes.length}
            </Badge>
          </Group>
          {nodes.length === 0 ? (
            <Text size="sm" style={{ color: MIST }}>
              {t('dashboard.nodes.empty')}
            </Text>
          ) : (
            <ScrollArea.Autosize mah={320}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={MONO_LABEL}>{t('dashboard.nodes.cols.name')}</Table.Th>
                    <Table.Th style={MONO_LABEL}>{t('dashboard.nodes.cols.status')}</Table.Th>
                    <Table.Th style={MONO_LABEL}>{t('dashboard.health.cpu')}</Table.Th>
                    <Table.Th style={MONO_LABEL}>{t('dashboard.health.ram')}</Table.Th>
                    <Table.Th style={MONO_LABEL}>{t('dashboard.health.disk')}</Table.Th>
                    <Table.Th ta="right" style={MONO_LABEL}>{t('dashboard.nodes.cols.profiles')}</Table.Th>
                    <Table.Th ta="right" style={MONO_LABEL}>{t('dashboard.nodes.cols.today')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {nodes.map((n) => (
                    <Table.Tr key={n.id}>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text size="sm" fw={500} style={{ color: SNOW }}>
                            {n.countryCode ? `${flagEmoji(n.countryCode)} ` : ''}
                            {n.name}
                          </Text>
                          <Text size="xs" style={{ color: MIST, fontFamily: "'Geist Mono', monospace" }}>
                            {n.address}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={
                            n.lastStatusChange
                              ? t('dashboard.nodes.statusChanged', { when: relativeTime(n.lastStatusChange) })
                              : t('dashboard.nodes.statusUnknown')
                          }
                        >
                          <StatusDot color={NODE_STATUS_COLOR[n.status] ?? MIST} label={n.status} />
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <NodeMiniBar
                          percent={n.metrics?.cpu.usagePercent ?? null}
                          tooltip={
                            n.metrics
                              ? `${n.metrics.cpu.cores} cores · LA ${n.metrics.cpu.loadAvg1.toFixed(2)}/${n.metrics.cpu.loadAvg5.toFixed(2)}/${n.metrics.cpu.loadAvg15.toFixed(2)}`
                              : t('dashboard.nodes.metricsMissing')
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <NodeMiniBar
                          percent={n.metrics?.memory.usedPercent ?? null}
                          tooltip={
                            n.metrics
                              ? `${formatBytes(n.metrics.memory.usedBytes)} / ${formatBytes(n.metrics.memory.totalBytes)}`
                              : t('dashboard.nodes.metricsMissing')
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <NodeMiniBar
                          percent={n.metrics?.disk.usedPercent ?? null}
                          tooltip={
                            n.metrics
                              ? `${formatBytes(n.metrics.disk.usedBytes)} / ${formatBytes(n.metrics.disk.totalBytes)}`
                              : t('dashboard.nodes.metricsMissing')
                          }
                        />
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}>
                          {n.inboundCount}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}>
                          {formatBytes(n.todayBytes)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Card>

        <Card withBorder padding="lg" radius="md" style={cardStyle}>
          <Group gap="xs" mb="md">
            <ThemeIcon
              size={28}
              radius="md"
              variant="light"
              style={{ backgroundColor: `${MOSS}1A`, color: MOSS, border: `1px solid ${MOSS}33` }}
            >
              <IconNetwork size={16} />
            </ThemeIcon>
            <Text fw={600} style={{ color: SNOW }}>
              {t('dashboard.protocols.title')}
            </Text>
            <Badge variant="light" style={{ backgroundColor: `${MIST}1A`, color: MIST }}>
              {byProtocol.length}
            </Badge>
          </Group>
          {byProtocol.length === 0 ? (
            <Text size="sm" style={{ color: MIST }}>
              {t('dashboard.protocols.empty')}
            </Text>
          ) : (
            <Stack gap="xs">
              {byProtocol.map((p) => (
                <Card
                  key={p.protocol}
                  withBorder
                  p="sm"
                  radius="sm"
                  style={{ backgroundColor: '#08101A', borderColor: HAIRLINE }}
                >
                  <Group justify="space-between">
                    <Group gap="sm">
                      <Badge
                        variant="light"
                        style={{ backgroundColor: `${CYAN}1A`, color: CYAN, border: `1px solid ${CYAN}33` }}
                      >
                        {p.protocol}
                      </Badge>
                      <Text size="sm" style={{ color: MIST }}>
                        {t('dashboard.protocols.profilesCount', { count: p.inboundCount })}
                      </Text>
                    </Group>
                    <Group gap={4} align="baseline">
                      <Text size="sm" fw={600} style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}>
                        {p.enabledUserCount}
                      </Text>
                      <Text size="xs" style={{ color: MIST }}>
                        {t('dashboard.protocols.users')}
                      </Text>
                    </Group>
                  </Group>
                </Card>
              ))}
            </Stack>
          )}
        </Card>
      </SimpleGrid>

      {/* Two-column row: top users + recent events */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder padding="lg" radius="md" style={cardStyle}>
          <Group gap="xs" mb="md">
            <ThemeIcon
              size={28}
              radius="md"
              variant="light"
              style={{ backgroundColor: `${AMBER}1A`, color: AMBER, border: `1px solid ${AMBER}33` }}
            >
              <IconActivity size={16} />
            </ThemeIcon>
            <Text fw={600} style={{ color: SNOW }}>
              {t('dashboard.topUsers.title')}
            </Text>
          </Group>
          {topUsersToday.length === 0 ? (
            <Text size="sm" style={{ color: MIST }}>
              {t('dashboard.topUsers.empty')}
            </Text>
          ) : (
            <Stack gap="xs">
              {topUsersToday.map((u, i) => (
                <Group key={u.id} justify="space-between">
                  <Group gap="sm">
                    <ThemeIcon
                      size={22}
                      radius="xl"
                      variant="light"
                      style={{
                        backgroundColor: i === 0 ? `${AMBER}1A` : `${MIST}1A`,
                        color: i === 0 ? AMBER : MIST,
                        border: `1px solid ${i === 0 ? AMBER : MIST}33`,
                      }}
                    >
                      <Text size="xs" fw={700}>
                        {i + 1}
                      </Text>
                    </ThemeIcon>
                    <Text size="sm" style={{ color: SNOW }}>{u.username}</Text>
                  </Group>
                  <Text size="sm" fw={600} style={{ color: SNOW, fontFamily: "'Geist Mono', monospace" }}>
                    {formatBytes(u.bytes)}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </Card>

        <Card withBorder padding="lg" radius="md" style={cardStyle}>
          <Group gap="xs" mb="md">
            <ThemeIcon
              size={28}
              radius="md"
              variant="light"
              style={{ backgroundColor: `${VIOLET}1A`, color: VIOLET, border: `1px solid ${VIOLET}33` }}
            >
              <IconClock size={16} />
            </ThemeIcon>
            <Text fw={600} style={{ color: SNOW }}>
              {t('dashboard.events.title')}
            </Text>
          </Group>
          {recentEvents.length === 0 ? (
            <Text size="sm" style={{ color: MIST }}>
              {t('dashboard.events.empty')}
            </Text>
          ) : (
            <Stack gap="xs">
              {recentEvents.map((e) => {
                const isCreate = e.eventType === 'user.created';
                const Icon = isCreate ? IconArrowUpRight : IconArrowDownRight;
                const accent = EVENT_COLOR[e.eventType] ?? MIST;
                return (
                  <Group key={e.id} justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                      <ThemeIcon
                        size={22}
                        radius="xl"
                        variant="light"
                        style={{
                          backgroundColor: `${accent}1A`,
                          color: accent,
                          border: `1px solid ${accent}33`,
                        }}
                      >
                        <Icon size={12} />
                      </ThemeIcon>
                      <Stack gap={0}>
                        <Text size="sm" style={{ color: SNOW }}>{e.eventType}</Text>
                        <Text size="xs" style={{ color: MIST, fontFamily: "'Geist Mono', monospace" }}>
                          {e.username ?? e.userId.slice(0, 8)}
                        </Text>
                      </Stack>
                    </Group>
                    <Tooltip label={new Date(e.createdAt).toLocaleString()}>
                      <Text size="xs" style={{ color: MIST }}>
                        {relativeTime(e.createdAt)}
                      </Text>
                    </Tooltip>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Card>
      </SimpleGrid>

      {/* Footer summary */}
      <Group
        justify="space-between"
        gap="xs"
        pt="md"
        mt="md"
        style={{ borderTop: `1px solid ${HAIRLINE}` }}
      >
        <Group gap={8}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: users.neverOnline > 0 ? AMBER : MOSS,
              boxShadow: `0 0 6px ${(users.neverOnline > 0 ? AMBER : MOSS)}99`,
            }}
          />
          <Text style={{ ...MONO_LABEL, color: users.neverOnline > 0 ? AMBER : MIST }}>
            {users.total === 0
              ? t('pageHero.dashboardFooterNoUsers')
              : users.neverOnline > 0
                ? t(
                    users.neverOnline === 1
                      ? 'pageHero.dashboardFooterNeverOnline'
                      : 'pageHero.dashboardFooterNeverOnlinePlural',
                    { count: users.neverOnline },
                  )
                : t('pageHero.dashboardFooterAllProvisioned')}
          </Text>
        </Group>
        <Text style={{ ...MONO_LABEL }}>
          {new Date(now()).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }).toUpperCase()}
          {' '}MSK · v{__APP_VERSION__}
        </Text>
      </Group>
    </Stack>
  );
}

function SystemHealth({ host }: { host: DashboardOverview['host'] }) {
  const { t } = useTranslation();
  // Headline = load-average-derived % (1-min, smoothed), not the 200ms
  // instantaneous sample. The sample is taken while the backend builds the
  // dashboard (parallel SQL burst), so on a 1-vCPU host it measures its own
  // work and spikes to 80%+, misleading. loadPercent reflects sustained
  // busy-ness. Fall back to the sample where loadavg is unavailable (Windows
  // returns 0,0,0 → loadPercent null).
  const cpuPct = host.cpu.loadPercent ?? host.cpu.samplePercent;
  const cpuColor = thresholdColor(cpuPct);
  const memColor = thresholdColor(host.memory.usedPercent, 75, 90);
  const diskColor = host.disk ? thresholdColor(host.disk.usedPercent, 80, 90) : MIST;

  return (
    <Card withBorder padding="lg" radius="md" style={cardStyle}>
      <Group justify="space-between" align="center" mb="md">
        <Group gap={10}>
          <Box style={{ color: CYAN, display: 'flex' }}>
            <IconDeviceDesktopAnalytics size={18} />
          </Box>
          <Text
            style={{
              ...DISPLAY,
              fontSize: 15,
              fontWeight: 500,
              color: SNOW,
            }}
          >
            {t('dashboard.health.title')}{' '}
            <span style={{ color: MIST }}>· {t('pageHero.hostSystemSubtitle')}</span>
          </Text>
        </Group>
        <Text style={{ ...MONO_LABEL, fontSize: 9, letterSpacing: '0.14em' }}>
          {t('pageHero.uptimeLabel').toUpperCase()}{' '}
          {formatUptime(host.process.uptimeSeconds).toUpperCase()} ·{' '}
          {t('pageHero.sampledLabel').toUpperCase()}{' '}
          {new Date(now()).toLocaleTimeString('en-GB', { hour12: false })}
        </Text>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <UsageBar
          icon={<IconCpu size={16} />}
          color={cpuColor}
          label={t('dashboard.health.cpu')}
          percent={cpuPct}
          primary={`${cpuPct.toFixed(1)}%`}
          secondary={t('dashboard.health.cpuHint', {
            cores: host.cpu.cores,
            la1: host.cpu.loadavg[0].toFixed(2),
            la5: host.cpu.loadavg[1].toFixed(2),
            la15: host.cpu.loadavg[2].toFixed(2),
          })}
        />
        <UsageBar
          icon={<IconDatabase size={16} />}
          color={memColor}
          label={t('dashboard.health.ram')}
          percent={host.memory.usedPercent}
          primary={`${formatBytes(host.memory.usedBytes)} / ${formatBytes(host.memory.totalBytes)}`}
          secondary={t('dashboard.health.memHint', { percent: host.memory.usedPercent.toFixed(1) })}
        />
        <UsageBar
          icon={<IconServer2 size={16} />}
          color={diskColor}
          label={t('dashboard.health.disk')}
          percent={host.disk?.usedPercent ?? 0}
          primary={
            host.disk
              ? `${formatBytes(host.disk.usedBytes)} / ${formatBytes(host.disk.totalBytes)}`
              : '-'
          }
          secondary={
            host.disk
              ? t('dashboard.health.memHint', { percent: host.disk.usedPercent.toFixed(1) })
              : t('dashboard.health.diskUnavailable')
          }
        />
        <UsageBar
          icon={<IconActivity size={16} />}
          color={VIOLET}
          label={t('dashboard.health.processMem')}
          percent={(host.process.heapUsedBytes / Math.max(1, host.process.heapLimitBytes)) * 100}
          primary={`RSS ${formatBytes(host.process.rssBytes)}`}
          secondary={t('dashboard.health.processSecondary', {
            used: formatBytes(host.process.heapUsedBytes),
            total: formatBytes(host.process.heapLimitBytes),
          })}
        />
      </SimpleGrid>
    </Card>
  );
}

function UsageBar({
  icon,
  label,
  percent,
  primary,
  secondary,
  color,
}: {
  icon: ReactNode;
  label: string;
  percent: number;
  primary: string;
  secondary: string;
  color: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <Card withBorder p="md" radius="sm" style={{ backgroundColor: '#08101A', borderColor: HAIRLINE }}>
      <Group justify="space-between" align="center" mb={10}>
        <Group gap={8}>
          <Box style={{ color, display: 'flex' }}>{icon}</Box>
          <Text size="sm" fw={500} style={{ color: SNOW }}>
            {label}
          </Text>
        </Group>
        <Text
          style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: 11,
            color,
            fontWeight: 500,
          }}
        >
          {percent.toFixed(0)}%
        </Text>
      </Group>
      <Progress
        value={clamped}
        size="xs"
        radius="xs"
        styles={{
          root: { backgroundColor: HAIRLINE },
          section: { backgroundColor: color },
        }}
        mb={10}
      />
      <Text
        style={{
          ...DISPLAY,
          fontSize: 20,
          fontWeight: 500,
          color: SNOW,
          lineHeight: 1,
          marginBottom: 4,
        }}
      >
        {primary}
      </Text>
      <Text size="xs" style={{ color: MIST, fontFamily: "'Geist Mono', monospace" }}>
        {secondary}
      </Text>
    </Card>
  );
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function NodeMiniBar({
  percent,
  tooltip,
}: {
  percent: number | null;
  tooltip: string;
}) {
  if (percent === null) {
    return (
      <Text size="xs" style={{ color: MIST }}>
        -
      </Text>
    );
  }
  const color = thresholdColor(percent, 75, 90);
  return (
    <Tooltip label={tooltip}>
      <Stack gap={2} miw={90}>
        <Progress
          value={Math.min(100, percent)}
          size="sm"
          radius="xl"
          styles={{
            root: { backgroundColor: HAIRLINE },
            section: { backgroundColor: color },
          }}
        />
        <Text size="xs" style={{ color: MIST, fontFamily: "'Geist Mono', monospace" }}>
          {percent.toFixed(0)}%
        </Text>
      </Stack>
    </Tooltip>
  );
}

function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}99`,
          flexShrink: 0,
        }}
      />
      <Text size="xs" style={{ color: SNOW, textTransform: 'capitalize' }}>
        {label}
      </Text>
    </Group>
  );
}

function TrafficStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  // K1 - "vs previous period" delta from formatDelta(); undefined = no delta row.
  delta?: { text: string; positive: boolean; noData: boolean };
}) {
  return (
    <Stack gap={4} align="flex-end">
      <Text style={{ ...MONO_LABEL, fontSize: 9, letterSpacing: '0.14em' }}>{label}</Text>
      <Text style={{ ...DISPLAY, fontSize: 16, fontWeight: 500, color: SNOW, lineHeight: 1 }}>
        {value}
      </Text>
      {delta && !delta.noData && delta.text && (
        <Text style={{ fontSize: 10, lineHeight: 1, color: delta.positive ? '#3FE0A0' : '#F2787E' }}>
          {delta.text}
        </Text>
      )}
    </Stack>
  );
}

function StatusChip({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <Card withBorder p="md" radius="sm" style={{ backgroundColor: '#08101A', borderColor: HAIRLINE }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb={12}>
        <Text style={{ ...MONO_LABEL, fontSize: 9, letterSpacing: '0.14em' }}>{label}</Text>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: dot,
            boxShadow: `0 0 6px ${dot}99`,
            marginTop: 4,
            flexShrink: 0,
          }}
        />
      </Group>
      <Text
        style={{ ...DISPLAY, fontSize: 36, fontWeight: 500, color: SNOW, lineHeight: 1 }}
      >
        {value}
      </Text>
    </Card>
  );
}

function flagEmoji(cc: string): string {
  if (cc.length !== 2) return '';
  const up = cc.toUpperCase();
  const c0 = up.charCodeAt(0);
  const c1 = up.charCodeAt(1);
  // LOW: only ISO-3166 alpha-2 (A-Z) map to regional-indicator flags. A
  // non-letter code (digits, region slug, '??') otherwise produced garbage
  // codepoints outside the flag range.
  if (c0 < 65 || c0 > 90 || c1 < 65 || c1 > 90) return '';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (c0 - a)) + String.fromCodePoint(A + (c1 - a));
}
