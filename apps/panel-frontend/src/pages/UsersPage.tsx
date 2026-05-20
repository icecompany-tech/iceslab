import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Menu,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { copyToClipboard } from '../lib/clipboard';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCircleMinus,
  IconCircleOff,
  IconClockHour4,
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconExternalLink,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUserOff,
  IconUsers,
} from '@tabler/icons-react';
import {
  createUser,
  deleteUser,
  fetchAuthStatus,
  getDashboardOverview,
  listSquads,
  listUsers,
  subscriptionUrl,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
  type User,
} from '../lib/api';
import { UserFormModal } from '../components/UserFormModal';
import { PageHero } from '../components/PageHero';
import { PrimaryButton } from '../components/PrimaryButton';

// ───── Helpers ─────

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

const DISPLAY = { fontFamily: "'Space Grotesk', Inter, sans-serif" };
const MONO = { fontFamily: "'Geist Mono', monospace" };
const MONO_LABEL = {
  ...MONO,
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

/**
 * Computed status shown in the row pill. Paper's design surfaces *connection*
 * state ("ONLINE/OFFLINE") instead of lifecycle, with lifecycle states
 * (LIMITED/EXPIRED/DISABLED) overriding the pill when they apply. Order of
 * precedence: lifecycle override → connection inferred from lastOnlineAt.
 */
type ComputedStatus = 'online' | 'offline' | 'limited' | 'expired' | 'disabled';

function computedStatus(u: User): ComputedStatus {
  if (u.status === 'expired') return 'expired';
  if (u.status === 'limited') return 'limited';
  if (u.status === 'disabled') return 'disabled';
  if (!u.lastOnlineAt) return 'offline';
  const sinceMs = Date.now() - new Date(u.lastOnlineAt).getTime();
  return sinceMs < 5 * 60 * 1000 ? 'online' : 'offline';
}

const COMPUTED_STATUS_ACCENT: Record<ComputedStatus, string> = {
  online: MOSS,
  offline: MIST,
  limited: AMBER,
  expired: RED,
  disabled: MIST,
};

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function trafficPercent(used: number, limit: number | null): number | null {
  if (limit === null || limit === 0) return null;
  return Math.min(100, (used / limit) * 100);
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function relativeTime(
  iso: string | null,
  t: TFn,
): { text: string; tone: 'fresh' | 'stale' | 'never' } {
  if (!iso) return { text: t('userTime.never'), tone: 'never' };
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  const tone: 'fresh' | 'stale' = sec < 5 * 60 ? 'fresh' : 'stale';
  if (sec < 60) return { text: t('userTime.sAgo', { n: sec }), tone };
  const min = Math.round(sec / 60);
  if (min < 60) return { text: t('userTime.mAgo', { n: min }), tone };
  const hr = Math.round(min / 60);
  if (hr < 24) return { text: t('userTime.hAgo', { n: hr }), tone };
  const days = Math.round(hr / 24);
  return { text: t('userTime.dAgo', { n: days }), tone };
}

function expireRelative(
  iso: string | null,
  t: TFn,
): { text: string; tone: 'good' | 'warn' | 'bad' | 'never' } {
  if (!iso) return { text: t('userTime.noExpiry'), tone: 'never' };
  const diffMs = new Date(iso).getTime() - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: t('userTime.expiredAgo', { days: -days }), tone: 'bad' };
  if (days === 0) return { text: t('userTime.expiresToday'), tone: 'bad' };
  if (days <= 7) return { text: t('userTime.daysLeft', { days }), tone: 'warn' };
  return { text: t('userTime.daysLeft', { days }), tone: 'good' };
}

// ───── Stats card ─────

interface StatChipProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}

function StatChip({ icon, label, value, accent, active, onClick }: StatChipProps) {
  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: CARD,
        borderColor: active ? accent : HAIRLINE,
        borderWidth: active ? 2 : 1,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Text style={MONO_LABEL}>{label}</Text>
          <Text style={{ ...DISPLAY, fontSize: 28, fontWeight: 500, lineHeight: 1, color: SNOW }}>
            {value}
          </Text>
        </Stack>
        <ThemeIcon
          size={36}
          radius="md"
          variant="light"
          style={{
            backgroundColor: `${accent}1A`,
            color: accent,
            border: `1px solid ${accent}33`,
          }}
        >
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
}

// ───── Main page ─────

type StatusFilter = 'all' | 'active' | 'expired' | 'limited' | 'disabled';

export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Wave-14 #17: server-side pagination + filter + search. Pre-wave we
  // fetched limit:500 once and paged/filtered/searched in JS; this silently
  // truncated installs >500 users and re-rendered the full table on every
  // keystroke. Backend already supported `page/limit/status/search`; UI just
  // wasn't passing them.
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const serverStatus = statusFilter === 'all' ? undefined : statusFilter;
  const serverSearch = debouncedSearch.trim() || undefined;
  const usersQuery = useQuery({
    queryKey: ['users', { page, limit: rowsPerPage, status: serverStatus, search: serverSearch }],
    queryFn: () =>
      listUsers({ page, limit: rowsPerPage, status: serverStatus, search: serverSearch }),
    placeholderData: (prev) => prev,
  });
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  // Wave-14 #16: subscriptionUrl(token) without a second arg falls back to
  // API_BASE_URL, which defaults to http://localhost:3000 — so a prod SPA
  // built without VITE_API_BASE_URL silently copies a localhost link to the
  // operator's clipboard. Same panel-metadata source UserFormModal uses.
  const authStatusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  // Wave-14 #17: full-install counters come from dashboard.users (cached
  // server-side, ~ N/A cost) instead of computed from the current page slice
  // — the slice doesn't reflect total install state under server pagination.
  const dashQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    staleTime: 10_000,
  });
  const squadNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of squadsQuery.data?.squads ?? []) m.set(s.id, s.name);
    return m;
  }, [squadsQuery.data]);

  const pagedUsers = usersQuery.data?.users ?? [];
  const totalUsers = usersQuery.data?.total ?? 0;

  const stats = useMemo(() => {
    const byStatus = dashQuery.data?.users.byStatus ?? {};
    return {
      total: dashQuery.data?.users.total ?? totalUsers,
      active: byStatus.active ?? 0,
      expired: byStatus.expired ?? 0,
      limited: byStatus.limited ?? 0,
      disabled: byStatus.disabled ?? 0,
    };
  }, [dashQuery.data, totalUsers]);

  // Reset to page 1 whenever any server-filter input changes so a narrowed
  // result set doesn't drop us into an empty page (page 5 of 1 page).
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch, rowsPerPage]);

  const totalPages = Math.max(1, Math.ceil(totalUsers / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const rangeStart = totalUsers === 0 ? 0 : (safePage - 1) * rowsPerPage + 1;
  const rangeEnd = Math.min(safePage * rowsPerPage, totalUsers);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.created') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(user: User) {
    modals.openConfirmModal({
      title: t('users.deleteTitle', { name: user.username }),
      children: (
        <Text size="sm">
          {t('users.deleteBody')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(user.id),
    });
  }

  return (
    <Stack gap="lg">
      <PageHero
        eyebrow={t('pageHero.usersEyebrow', {
          // `count` drives i18next pluralization (one/few/many/other for RU,
          // one/other for EN). Without it the eyebrow rendered "1 аккаунтов"
          // on a single user — caught during the post-refactor audit.
          count: stats.total,
          online: stats.active,
          limited:
            stats.limited > 0
              ? t('pageHero.usersEyebrowLimited', { count: stats.limited })
              : '',
        })}
        title={t('pageHero.usersTitle')}
        subtitle={t('pageHero.usersSubtitle')}
        right={
          <Group gap={8}>
            <Tooltip label={t('common.refresh')}>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}
                loading={usersQuery.isFetching}
                style={{ color: MIST }}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <PrimaryButton leftSection={<IconPlus size={14} />} onClick={openCreate}>
              {t('users.create')}
            </PrimaryButton>
          </Group>
        }
      />

      {/* Stats row - clickable as filters */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <StatChip
          icon={<IconUsers size={20} />}
          label={t('common.all')}
          value={stats.total}
          accent={CYAN}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatChip
          icon={<IconCircleCheck size={20} />}
          label={t('users.statChips.active')}
          value={stats.active}
          accent={MOSS}
          active={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        />
        <StatChip
          icon={<IconClockHour4 size={20} />}
          label={t('users.statChips.expired')}
          value={stats.expired}
          accent={RED}
          active={statusFilter === 'expired'}
          onClick={() => setStatusFilter('expired')}
        />
        <StatChip
          icon={<IconCircleMinus size={20} />}
          label={t('users.statChips.limited')}
          value={stats.limited}
          accent={AMBER}
          active={statusFilter === 'limited'}
          onClick={() => setStatusFilter('limited')}
        />
        <StatChip
          icon={<IconCircleOff size={20} />}
          label={t('users.statChips.disabled')}
          value={stats.disabled}
          accent={MIST}
          active={statusFilter === 'disabled'}
          onClick={() => setStatusFilter('disabled')}
        />
      </SimpleGrid>

      {/* Search + filters */}
      <Group gap="sm" wrap="nowrap">
        <TextInput
          placeholder={t('users.searchPlaceholder')}
          leftSection={<IconSearch size={16} color={MIST} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1 }}
          styles={{
            input: { backgroundColor: CARD, borderColor: HAIRLINE, color: SNOW },
          }}
        />
        <SegmentedControl
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          data={[
            { value: 'all', label: t('common.all') },
            { value: 'active', label: t('users.statChips.active') },
            { value: 'expired', label: t('users.statChips.expired') },
            { value: 'limited', label: t('users.statChips.limited') },
            { value: 'disabled', label: t('users.statChips.disabled') },
          ]}
          size="sm"
          visibleFrom="md"
        />
      </Group>

      {/* Table */}
      <Card withBorder padding={0} radius="md" style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
        <Table.ScrollContainer minWidth={1100}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                <Table.Th style={MONO_LABEL}>{t('users.table.username')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.status')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.subscription')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.expires')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.traffic')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.squads')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.tag')}</Table.Th>
                <Table.Th style={{ width: 1, ...MONO_LABEL }}>{t('common.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredUsers.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={9}>
                    <Stack align="center" py="xl" gap="xs">
                      <ThemeIcon size={40} radius="md" variant="light" color="gray">
                        <IconUserOff size={22} />
                      </ThemeIcon>
                      <Text c="dimmed" size="sm">
                        {allUsers.length === 0
                          ? t('users.empty')
                          : t('common.nothingFound')}
                      </Text>
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              )}
              {pagedUsers.map((u) => {
                const last = relativeTime(u.lastOnlineAt, t);
                const exp = expireRelative(u.expireAt, t);
                const trafficPct = trafficPercent(u.trafficUsedBytes, u.trafficLimitBytes);
                const trafficColor =
                  trafficPct === null
                    ? MOSS
                    : trafficPct >= 90
                      ? RED
                      : trafficPct >= 70
                        ? AMBER
                        : MOSS;
                const compStatus = computedStatus(u);
                const statusAccent = COMPUTED_STATUS_ACCENT[compStatus];
                const rowTint =
                  compStatus === 'expired'
                    ? `${RED}08`
                    : compStatus === 'limited'
                      ? `${AMBER}08`
                      : undefined;
                const isPaused = compStatus === 'limited' || compStatus === 'expired';
                const otherSquads = u.groupIds.filter(
                  (id) => id !== '00000000-0000-0000-0000-000000000001',
                );
                const subUrl = subscriptionUrl(u.subscriptionToken, authStatusQuery.data?.panel);

                return (
                  <Table.Tr
                    key={u.id}
                    style={{
                      backgroundColor: rowTint,
                      borderBottom: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <StatusDot accent={statusAccent} />
                        <Stack gap={2}>
                          <Text size="sm" fw={500} style={{ color: SNOW }}>
                            {u.username}
                          </Text>
                          <Text size="xs" style={{ ...MONO, color: MIST }}>
                            {u.shortId}
                            {u.telegramId ? ` · ${u.telegramId.startsWith('@') ? u.telegramId : '@' + u.telegramId}` : ''}
                          </Text>
                        </Stack>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        style={{
                          backgroundColor: `${statusAccent}1A`,
                          color: statusAccent,
                          border: `1px solid ${statusAccent}33`,
                          textTransform: 'uppercase',
                          ...MONO,
                          letterSpacing: '0.08em',
                        }}
                      >
                        {t(`userStatus.${compStatus}`)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={u.lastOnlineAt ? new Date(u.lastOnlineAt).toLocaleString() : '-'}
                      >
                        <Text
                          size="sm"
                          style={{
                            color:
                              last.tone === 'fresh' ? MOSS : last.tone === 'never' ? MIST : SNOW,
                          }}
                        >
                          {last.text}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={u.expireAt ? new Date(u.expireAt).toLocaleString() : '-'}>
                        <Text
                          size="sm"
                          style={{
                            color:
                              exp.tone === 'bad'
                                ? RED
                                : exp.tone === 'warn'
                                  ? AMBER
                                  : exp.tone === 'never'
                                    ? MIST
                                    : SNOW,
                          }}
                        >
                          {exp.text}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td miw={200}>
                      <Stack gap={4}>
                        <Group justify="space-between" gap="xs">
                          {isPaused ? (
                            <Text size="xs" fw={600} style={{ ...MONO, color: compStatus === 'expired' ? RED : AMBER }}>
                              {t('usersTable.paused')}
                            </Text>
                          ) : (
                            <Text size="xs" style={{ ...MONO, color: SNOW }}>
                              {formatBytes(u.trafficUsedBytes)}{' '}
                              <Text span style={{ color: MIST }}>
                                /{' '}
                                {u.trafficLimitBytes === null
                                  ? '∞'
                                  : formatBytes(u.trafficLimitBytes)}
                              </Text>
                            </Text>
                          )}
                          {isPaused ? (
                            <Text size="xs" style={{ ...MONO, color: MIST }}>
                              {compStatus === 'expired'
                                ? t('usersTable.pausedHintExpired')
                                : t('usersTable.pausedHintQuota')}
                            </Text>
                          ) : trafficPct !== null ? (
                            <Text size="xs" fw={600} style={{ ...MONO, color: trafficColor }}>
                              {trafficPct.toFixed(0)}%
                            </Text>
                          ) : null}
                        </Group>
                        <Progress
                          value={isPaused ? 100 : trafficPct ?? 0}
                          size="sm"
                          radius="xl"
                          styles={{
                            root: { backgroundColor: HAIRLINE },
                            section: {
                              backgroundColor: isPaused
                                ? compStatus === 'expired'
                                  ? RED
                                  : AMBER
                                : trafficColor,
                            },
                          }}
                        />
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {otherSquads.length === 0 ? (
                        <Badge
                          variant="default"
                          size="sm"
                          style={{ backgroundColor: `${MIST}1A`, color: MIST }}
                        >
                          All
                        </Badge>
                      ) : (
                        <Group gap={4}>
                          {otherSquads.slice(0, 2).map((id) => (
                            <Badge
                              key={id}
                              variant="light"
                              size="sm"
                              style={{
                                backgroundColor: `${VIOLET}1A`,
                                color: VIOLET,
                                border: `1px solid ${VIOLET}33`,
                              }}
                            >
                              {squadNameById.get(id) ?? id.slice(0, 6)}
                            </Badge>
                          ))}
                          {otherSquads.length > 2 && (
                            <Badge
                              variant="default"
                              size="sm"
                              style={{ backgroundColor: `${MIST}1A`, color: MIST }}
                            >
                              +{otherSquads.length - 2}
                            </Badge>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" style={{ ...MONO, color: u.tag ? MIST : MIST }}>
                        {u.tag ?? '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Menu shadow="md" position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="sm" style={{ color: MIST }}>
                            <IconDotsVertical size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
                          <Menu.Item
                            leftSection={<IconCopy size={14} />}
                            onClick={() => copyToClipboard(subUrl)}
                          >
                            {t('usersTable.actionCopySubUrl')}
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconExternalLink size={14} />}
                            component="a"
                            href={subUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('usersTable.actionOpenSub')}
                          </Menu.Item>
                          <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(u)}>
                            {t('usersTable.actionEdit')}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => handleDelete(u)}
                          >
                            {t('usersTable.actionDelete')}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {filteredUsers.length > 0 && (
          <Group
            justify="flex-end"
            gap="lg"
            px="md"
            py="sm"
            style={{ borderTop: `1px solid ${HAIRLINE}` }}
          >
            <Group gap={8}>
              <Text style={MONO_LABEL}>{t('usersTable.rowsPerPage')}</Text>
              <Select
                size="xs"
                value={String(rowsPerPage)}
                onChange={(v) => setRowsPerPage(Number(v) || 25)}
                data={['10', '25', '50', '100']}
                allowDeselect={false}
                w={72}
                styles={{
                  input: {
                    backgroundColor: GROUND,
                    borderColor: HAIRLINE,
                    color: SNOW,
                    ...MONO,
                  },
                }}
              />
            </Group>
            <Text style={{ ...MONO_LABEL, color: SNOW }}>
              {rangeStart}-{rangeEnd} {t('usersTable.of')} {filteredUsers.length}
            </Text>
            <Group gap={4}>
              <ActionIcon
                variant="subtle"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ color: safePage <= 1 ? MIST : SNOW }}
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{ color: safePage >= totalPages ? MIST : SNOW }}
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            </Group>
          </Group>
        )}
      </Card>

      <UserFormModal
        opened={createOpen}
        onClose={closeCreate}
        user={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateUserInput);
        }}
      />

      <UserFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        user={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateUserInput });
        }}
      />
    </Stack>
  );
}

function StatusDot({ accent }: { accent: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        backgroundColor: accent,
        boxShadow: `0 0 8px ${accent}99`,
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}
