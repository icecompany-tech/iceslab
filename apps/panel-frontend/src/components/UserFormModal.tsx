import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { DEMO_MODE } from '../lib/demoFlag';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconChartBar,
  IconCopy,
  IconDeviceDesktop,
  IconLink,
  IconLock,
  IconMail,
  IconRoute,
  IconShield,
  IconTag,
  IconTrash,
  IconUser,
} from '@tabler/icons-react';
import type { RoutingPresetId } from '@iceslab/shared';
import { copyToClipboard } from '../lib/clipboard';
import {
  ALL_SQUAD_ID,
  deleteHwidDevice,
  fetchAuthStatus,
  fetchUserEndpoints,
  listSquads,
  listUserDevices,
  subscriptionUrl,
  type CreateUserInput,
  type HwidDevice,
  type TrafficLimitStrategy,
  type UpdateUserInput,
  type User,
} from '../lib/api';

// Strategy values are stable enum keys; the label is built from the
// users.strategy.* i18n bundle inside the component so it follows the
// language switch.
const STRATEGY_VALUES: TrafficLimitStrategy[] = [
  'no_reset',
  'day',
  'week',
  'month',
  'rolling',
];

const GiB = 1_073_741_824;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

interface FormValues {
  username: string;
  trafficLimitGb: number | '';
  trafficLimitStrategy: TrafficLimitStrategy;
  expireDays: number | '';
  status: 'active' | 'disabled';
  description: string;
  tag: string;
  email: string;
  telegramId: string;
  hwidDeviceLimit: number | '';
  groupIds: string[];
  // R3 - '' = inherit (squad -> global -> default).
  routingPreset: string;
}

function defaultValues(user: User | null): FormValues {
  return {
    username: user?.username ?? '',
    trafficLimitGb:
      user?.trafficLimitBytes != null ? Math.round(user.trafficLimitBytes / GiB) : '',
    trafficLimitStrategy: user?.trafficLimitStrategy ?? 'no_reset',
    expireDays: '',
    // The edit form can only SET 'active' or 'disabled' (limited/expired are
    // cron-managed, and UpdateUserSchema rejects them — sending them back 400s
    // every save). Map the cron-only states to 'active': editing a limited/
    // expired user and saving reactivates them, which is what an admin bumping
    // a quota-hit user's traffic expects. If they're still over quota, the
    // review cron re-limits them next tick (self-correcting).
    status: user?.status === 'disabled' ? 'disabled' : 'active',
    description: user?.description ?? '',
    tag: user?.tag ?? '',
    email: user?.email ?? '',
    telegramId: user?.telegramId ?? '',
    hwidDeviceLimit: user?.hwidDeviceLimit ?? '',
    // Empty by default - backend falls back to ALL squad if no squads
    // picked. Pre-checking ALL here doubles up: admin checks Basic too →
    // form sends [ALL, Basic] → user ends up in BOTH squads, which inflates
    // dashboard per-protocol counters and surprises admins ("я ж только в
    // Basic положил"). Leave it empty - admin explicitly picks, otherwise
    // server auto-falls back to ALL.
    groupIds: user?.groupIds ?? [],
    // R3 - per-user routing override; '' = inherit the squad/global default.
    routingPreset: user?.routingPreset ?? '',
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  user: User | null;
  onSubmit: (input: CreateUserInput | UpdateUserInput) => Promise<void>;
  loading?: boolean;
}

export function UserFormModal({ opened, onClose, user, onSubmit, loading }: Props) {
  const { t } = useTranslation();
  const isEdit = user !== null;
  // STRATEGY_VALUES are stable enum keys; we render labels via t() so the
  // language switch reflows the select without re-mounting the form.
  // F12 - memoize so the array isn't rebuilt on every keystroke-driven render.
  const strategyOptions = useMemo(
    () => STRATEGY_VALUES.map((v) => ({ value: v, label: t(`users.strategy.${v}`) })),
    [t],
  );
  // F12 - status options, memoized for the same reason.
  const statusOptions = useMemo(
    () => [
      { value: 'active', label: t('userStatus.active') },
      { value: 'disabled', label: t('userStatus.disabled') },
    ],
    [t],
  );

  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });

  const form = useForm<FormValues>({
    initialValues: defaultValues(user),
    validate: {
      username: (v) => {
        if (isEdit) return null;
        if (v.length < 3) return t('validation.nameMin3');
        if (!/^[a-zA-Z0-9_-]+$/.test(v)) return t('validation.usernameLatinOnly');
        return null;
      },
      email: (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? t('validation.emailInvalid') : null),
    },
  });

  // Re-seed the form when the modal opens with a different user or when
  // the SAME user gets refreshed (e.g. after invalidateQueries returns
  // updated traffic/quota). Without including updatedAt in the deps the
  // effect skips re-seed for same-id+new-fields and admin's next "Save"
  // overwrites the refresh.
  useEffect(() => {
    if (opened && user !== null) {
      form.setValues(defaultValues(user));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, user?.id, user?.updatedAt]);

  async function handleSubmit(values: FormValues) {
    // Send what admin picked, no automatic ALL squad injection. Backend
    // falls back to ALL only when groupIds is empty (so users without an
    // explicit squad still get a subscription). Earlier code force-merged
    // ALL into every submit, which doubled users into multiple squads and
    // broke the per-squad-ACL invariant.
    const groupIds = values.groupIds;

    if (isEdit) {
      const input: UpdateUserInput = {
        status: values.status,
        // 0 or empty GB both mean "unlimited" -> null. The schema's
        // .positive() rejects a literal 0, so map it to null here.
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb) || null,
        trafficLimitStrategy: values.trafficLimitStrategy,
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit:
          values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds,
        // R3 - '' clears the override (back to inherit).
        routingPreset: (values.routingPreset as RoutingPresetId) || null,
      };
      await onSubmit(input);
    } else {
      const input: CreateUserInput = {
        username: values.username,
        // 0 or empty GB both mean "unlimited" -> null (schema .positive() rejects 0).
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb) || null,
        trafficLimitStrategy: values.trafficLimitStrategy,
        expireDays: values.expireDays === '' ? null : Number(values.expireDays),
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit:
          values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds,
        // R3 - '' = inherit the squad/global default.
        routingPreset: (values.routingPreset as RoutingPresetId) || null,
      };
      await onSubmit(input);
    }
    onClose();
    form.reset();
  }

  // Panel metadata (publicUrl + subscriptionPathPrefix) - drives the
  // copy-paste subscription URL admin sees. Cached app-wide by query key.
  const authStatusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  const subUrl = user
    ? subscriptionUrl(user.subscriptionToken, authStatusQuery.data?.panel)
    : '';

  // Per-protocol endpoint URIs for THIS user - fetched only when the
  // modal is open AND we have a user (i.e. editing, not creating). Each
  // endpoint exposes a ready-made URI string for client import / copy.
  const endpointsQuery = useQuery({
    queryKey: ['user-endpoints', user?.id],
    queryFn: () => fetchUserEndpoints(user!.id),
    enabled: opened && !!user?.id,
    staleTime: 30 * 1000,
  });

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={
        <Group gap="sm" align="center">
          <Card
            p={8}
            radius="md"
            style={{
              backgroundColor: '#7DD3FC1A',
              border: '1px solid #7DD3FC33',
              color: '#7DD3FC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconUser size={18} />
          </Card>
          <Stack gap={2}>
            <Text style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
              {isEdit ? user?.username ?? t('users.form.titleEdit') : t('modal.userNewTitle')}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isEdit ? t('modal.userEditSubtitle') : t('modal.userNewSubtitle')}
            </Text>
          </Stack>
        </Group>
      }
      size="xl"
      padding="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          {/* Profile header - only on edit */}
          {isEdit && user && (
            <ProfileHeader user={user} subUrl={subUrl} />
          )}

          {/* Per-protocol direct URIs - only on edit. Each endpoint
              (xray vless, hysteria2, ss, etc.) gets its own copy
              button so admin can ship a single-protocol link to a user
              without forcing them through a subscription importer.
              AWG has no URI scheme - its row offers "copy wgconf URL"
              instead (subscription URL with ?format=wgconf query). */}
          {isEdit && user && (
            <DirectEndpointsCard
              endpoints={endpointsQuery.data?.endpoints ?? []}
              loading={endpointsQuery.isLoading}
              error={endpointsQuery.error}
              subUrl={subUrl}
            />
          )}

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {/* LEFT column */}
            <Stack gap="md">
              {!isEdit && (
                <SectionCard icon={<IconUser size={16} />} title={t('users.form.sections.identity')}>
                  <TextInput
                    label={t('users.form.username')}
                    placeholder="alice"
                    required
                    {...form.getInputProps('username')}
                  />
                </SectionCard>
              )}

              {isEdit && (
                <SectionCard icon={<IconLock size={16} />} title={t('users.table.status')}>
                  <Select
                    label={t('users.table.status')}
                    data={statusOptions}
                    {...form.getInputProps('status')}
                  />
                </SectionCard>
              )}

              <SectionCard icon={<IconChartBar size={16} />} title={t('users.form.sections.traffic')}>
                <Stack gap="sm">
                  <NumberInput
                    label={t('users.form.trafficLimit')}
                    description={t('users.form.trafficLimitDesc')}
                    placeholder="500"
                    min={0}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('trafficLimitGb')}
                  />
                  <Select
                    label={t('users.form.resetStrategy')}
                    description={t('users.form.resetStrategyDesc')}
                    data={strategyOptions}
                    {...form.getInputProps('trafficLimitStrategy')}
                  />
                  {!isEdit && (
                    <NumberInput
                      label={t('users.form.expireDays')}
                      description={t('users.form.expireDaysDesc')}
                      placeholder="30"
                      min={1}
                      allowDecimal={false}
                      allowNegative={false}
                      {...form.getInputProps('expireDays')}
                    />
                  )}
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconMail size={16} />} title={t('users.form.sections.contact')}>
                <Stack gap="sm">
                  <TextInput
                    label={t('users.form.email')}
                    placeholder="user@example.com"
                    {...form.getInputProps('email')}
                  />
                  <TextInput
                    label={t('users.form.telegramId')}
                    placeholder={t('users.form.telegramIdPlaceholder')}
                    {...form.getInputProps('telegramId')}
                  />
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconTag size={16} />} title={t('users.form.sections.devices')}>
                <Stack gap="sm">
                  <NumberInput
                    label={t('users.form.hwidLimit')}
                    description={t('users.form.hwidLimitDesc')}
                    placeholder="3"
                    min={1}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('hwidDeviceLimit')}
                  />
                  {user && <UserDevicesPanel userId={user.id} />}
                  <TextInput
                    label={t('users.form.tag')}
                    placeholder={t('users.form.tagPlaceholder')}
                    {...form.getInputProps('tag')}
                  />
                  <Textarea
                    label={t('users.form.description')}
                    placeholder={t('users.form.descriptionPlaceholder')}
                    autosize
                    minRows={2}
                    maxRows={4}
                    {...form.getInputProps('description')}
                  />
                </Stack>
              </SectionCard>
            </Stack>

            {/* RIGHT column */}
            <Stack gap="md">
              <SectionCard icon={<IconShield size={16} />} title={t('users.form.sections.squads')}>
                <Text size="xs" c="dimmed" mb="xs">
                  {t('users.form.squadsDesc')}
                </Text>
                <Stack gap={6}>
                  {(squadsQuery.data?.squads ?? []).map((s) => {
                    const checked = form.values.groupIds.includes(s.id);
                    return (
                      <SquadRow
                        key={s.id}
                        name={s.name}
                        userCount={s.memberCount}
                        profileCount={s.profileIds.length}
                        checked={checked}
                        // Earlier the All-row was disabled — operators couldn't
                        // remove a user from All even when they wanted to and
                        // pre-checking on edit was confusing. Now any squad
                        // (incl. All) is freely toggleable; if the admin clears
                        // every squad the backend re-applies the All-fallback
                        // at save time so the user is never dead-on-arrival.
                        onToggle={() => {
                          const cur = form.values.groupIds;
                          form.setFieldValue(
                            'groupIds',
                            cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                          );
                        }}
                      />
                    );
                  })}
                </Stack>
                {/* Visible nudge when admin has both All and another squad
                    picked — used to silently double-count profiles on the
                    dashboard and surprise admins. Now they at least see it. */}
                {form.values.groupIds.includes(ALL_SQUAD_ID) &&
                  form.values.groupIds.length > 1 && (
                    <Text size="xs" c="yellow.4" mt="xs">
                      {t('users.form.squadsBothAllAndOther')}
                    </Text>
                  )}
                {form.values.groupIds.length === 0 && (
                  <Text size="xs" c="dimmed" mt="xs">
                    {t('users.form.squadsEmptyFallbackHint')}
                  </Text>
                )}
              </SectionCard>

              {/* R3 - per-user routing override. '' = inherit (squad ->
                  global -> default). Mirrors the squad routing select. */}
              <SectionCard icon={<IconRoute size={16} />} title={t('users.form.sections.routing')}>
                <Select
                  label={t('users.form.routing')}
                  description={t('users.form.routingDesc')}
                  data={[
                    { value: '', label: t('users.form.routingInherit') },
                    { value: 'proxy-all', label: t('users.form.routingProxyAll') },
                    { value: 'ru-split', label: t('users.form.routingRuSplit') },
                  ]}
                  allowDeselect={false}
                  {...form.getInputProps('routingPreset')}
                />
              </SectionCard>
            </Stack>
          </SimpleGrid>

          <Divider />

          <Group justify="space-between" gap="sm">
            <Group gap={12}>
              <Text
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#7A8BA3',
                }}
              >
                {isEdit ? t('modal.shortcutSave') : t('modal.shortcutCreate')}
              </Text>
            </Group>
            <Group gap="sm">
              <Button variant="default" onClick={onClose} disabled={loading}>
                {t('common.cancel')}
              </Button>
              <Tooltip label="Read-only demo" disabled={!DEMO_MODE} withArrow>
                <Button
                  type="submit"
                  loading={loading}
                  disabled={DEMO_MODE}
                  leftSection={<IconCheck size={16} />}
                  style={{ backgroundColor: '#2A93D1', color: '#08101A', fontWeight: 500 }}
                >
                  {isEdit ? t('users.form.submitEdit') : t('users.form.submitCreate')}
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ───── Helper components ─────

function SectionCard({
  icon,
  title,
  trailing,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={{ backgroundColor: '#0F1A28', borderColor: '#1C2A3D' }}
    >
      <Group gap={8} mb="sm" justify="space-between" align="center">
        <Group gap={8}>
          <span style={{ color: '#7DD3FC', display: 'flex' }}>{icon}</span>
          <Text
            style={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#7A8BA3',
              fontWeight: 500,
            }}
          >
            {title}
          </Text>
        </Group>
        {trailing && (
          <Text
            style={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#7A8BA3',
            }}
          >
            {trailing}
          </Text>
        )}
      </Group>
      {children}
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: 'teal',
  disabled: 'gray',
  expired: 'red',
  limited: 'yellow',
};

function ProfileHeader({ user, subUrl }: { user: User; subUrl: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await copyToClipboard(subUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Copy failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const used = user.trafficUsedBytes;
  const limit = user.trafficLimitBytes;
  const pct = limit !== null && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const trafficColor = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'teal';

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <ThemeIcon size={48} radius="md" variant="light">
            <IconUser size={24} />
          </ThemeIcon>
          <Stack gap={2}>
            <Group gap="xs">
              <Text size="lg" fw={700}>
                {user.username}
              </Text>
              <Badge variant="light" color={STATUS_COLORS[user.status] ?? 'gray'} tt="uppercase">
                {t(`userStatus.${user.status}`, { defaultValue: user.status })}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace">
              {user.shortId}
            </Text>
          </Stack>
        </Group>
      </Group>

      {/* Traffic bar */}
      <Stack gap={4} mt="md">
        <Group justify="space-between">
          <Text size="sm" ff="monospace">
            {formatBytes(used)}{' '}
            <Text span c="dimmed">
              / {limit === null ? '∞' : formatBytes(limit)}
            </Text>
          </Text>
          {limit !== null && (
            <Text size="sm" c={trafficColor} ff="monospace" fw={600}>
              {pct.toFixed(1)}%
            </Text>
          )}
        </Group>
        <Progress value={pct} color={trafficColor} size="sm" radius="xl" />
      </Stack>

      {/* Subscription URL */}
      <Paper withBorder mt="md" p="xs" radius="sm">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon variant="subtle" size={22} radius="sm" color="gray">
            <IconLink size={14} />
          </ThemeIcon>
          <Code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subUrl}
          </Code>
          <Tooltip label={copied ? t('userForm.copiedShort') : t('userForm.copyToClipboard')}>
            <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={handleCopy}>
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>
    </Card>
  );
}

function SquadRow({
  name,
  userCount,
  profileCount,
  checked,
  disabled,
  onToggle,
}: {
  name: string;
  userCount: number;
  profileCount: number;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      onClick={disabled ? undefined : onToggle}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Checkbox checked={checked} disabled={disabled} readOnly />
          <Text size="sm" fw={500}>
            {name}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label={t('userForm.tooltipUsers')}>
            <Badge variant="light" color="blue" size="sm">
              {userCount}
            </Badge>
          </Tooltip>
          <Tooltip label={t('userForm.tooltipProfiles')}>
            <Badge variant="light" color="indigo" size="sm">
              {profileCount}
            </Badge>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}

// ───── Slice S2: HWID devices panel ─────

/**
 * Lists HWID-tracked devices currently registered for this user. Each
 * row shows the hwid (truncated), first-seen / last-seen, and a delete
 * button to revoke the slot - admins use this to clean up after the
 * user replaced a phone or laptop.
 *
 * Devices are populated lazily on /sub/:token requests carrying an
 * `x-hwid` header. Empty list = either the user never opened a
 * HWID-aware client or no limit is set.
 */
function UserDevicesPanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ['hwid-devices', userId],
    queryFn: () => listUserDevices(userId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHwidDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hwid-devices', userId] });
      notifications.show({ color: 'green', message: t('common.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const devices = devicesQuery.data?.devices ?? [];

  return (
    <Stack gap={4}>
      <Group gap={6}>
        <IconDeviceDesktop size={14} />
        <Text size="sm" fw={500}>
          {t('users.form.devicesTitle', { count: devices.length })}
        </Text>
      </Group>
      {devices.length === 0 ? (
        <Text size="xs" c="dimmed">
          {t('users.form.devicesEmpty')}
        </Text>
      ) : (
        <Stack gap={4}>
          {devices.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              onDelete={() => deleteMutation.mutate(d.id)}
              deleting={
                deleteMutation.isPending &&
                deleteMutation.variables === d.id
              }
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function DeviceRow({
  device,
  onDelete,
  deleting,
}: {
  device: HwidDevice;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const truncated =
    device.hwid.length > 24 ? `${device.hwid.slice(0, 21)}…` : device.hwid;
  const lastSeen = new Date(device.lastSeenAt).toLocaleString();
  return (
    <Paper withBorder p="xs" radius="sm">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Group gap={6}>
            <Text size="xs" ff="monospace" truncate>
              {truncated}
            </Text>
            {device.label && (
              <Badge size="xs" variant="light">
                {device.label}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {t('users.form.deviceLastSeen', { when: lastSeen })}
          </Text>
        </Stack>
        <Tooltip label={t('users.form.deviceDelete')}>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            loading={deleting}
            onClick={onDelete}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}

// ───── Direct per-protocol URIs ─────
//
// Shows a card with one row per enabled endpoint (vless://, hysteria2://,
// ss://, awg-style identifier, etc) plus a "Copy" button. AWG has no URI
// scheme upstream - admin gets a placeholder pointing at the wgconf
// download link instead. Asked-for in cycle #6 2026-05-13: operators
// who deal with non-Hiddify clients (raw v2rayN, Shadowrocket) want a
// single-protocol link without the subscription wrapper.
function DirectEndpointsCard({
  endpoints,
  loading,
  error,
  subUrl,
}: {
  endpoints: Array<{ protocol: string; nodeName: string; host: string; port: number; uri: string }>;
  loading: boolean;
  error: unknown;
  subUrl: string;
}) {
  const { t } = useTranslation();
  const title = t('userForm.directLinksTitle');
  if (loading) {
    return (
      <SectionCard icon={<IconLink size={16} />} title={title}>
        <Text size="xs" c="dimmed">{t('userForm.directLinksLoading')}</Text>
      </SectionCard>
    );
  }
  if (error) {
    return (
      <SectionCard icon={<IconLink size={16} />} title={title}>
        <Text size="xs" c="red">{error instanceof Error ? error.message : String(error)}</Text>
      </SectionCard>
    );
  }
  if (endpoints.length === 0) {
    return (
      <SectionCard icon={<IconLink size={16} />} title={title}>
        <Text size="xs" c="dimmed">
          {t('userForm.directLinksEmpty')}
        </Text>
      </SectionCard>
    );
  }
  return (
    <SectionCard icon={<IconLink size={16} />} title={title}>
      <Stack gap={6}>
        {endpoints.map((e, idx) => (
          <DirectEndpointRow
            key={`${e.protocol}-${e.host}-${e.port}-${idx}`}
            endpoint={e}
            subUrl={subUrl}
          />
        ))}
      </Stack>
    </SectionCard>
  );
}

function DirectEndpointRow({
  endpoint,
  subUrl,
}: {
  endpoint: { protocol: string; nodeName: string; host: string; port: number; uri: string };
  subUrl: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const hasUri = endpoint.uri.length > 0;
  // For AWG there's no URI scheme - give admin the subscription URL with
  // ?format=wgconf. Both AmneziaVPN desktop ("File with config") and
  // Hiddify Next accept that URL directly (they fetch+parse). Pin &node=<name>
  // so a user with several AWG nodes gets THIS node's tunnel (wg-quick is one
  // peer per file); without it every AWG row resolves to the first node.
  const wgconfUrl =
    !hasUri && subUrl
      ? `${subUrl}?format=wgconf&node=${encodeURIComponent(endpoint.nodeName)}`
      : '';

  async function handleCopy() {
    const toCopy = hasUri ? endpoint.uri : wgconfUrl;
    if (!toCopy) return;
    try {
      await copyToClipboard(toCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Copy failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tooltipLabel = copied
    ? t('userForm.copiedShort')
    : hasUri
      ? t('userForm.copyUri')
      : t('userForm.copyWgconfHint');

  // mtg is single-secret upstream — every user of the inbound shares the
  // same wire identity, so per-user byte accounting is architecturally
  // impossible. The traffic counter and lastOnlineAt for MTProto-only
  // users will both look like the user never connected. Surface that
  // honestly with a small note so admins don't suspect a bug. (Panel-
  // side fallback in stats.cron.ts treats adapter-tracked presence as
  // "online", so the OFFLINE-forever bug is gone, but per-user TRAFFIC
  // counters remain at zero and per-user quotas don't apply.)
  const isMtproto = endpoint.protocol.toLowerCase() === 'mtproto';

  return (
    <Paper withBorder p="xs" radius="sm" style={{ overflow: 'hidden' }}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Badge variant="light" color="cyan" size="xs" tt="uppercase" style={{ flexShrink: 0 }}>
            {endpoint.protocol}
          </Badge>
          <Text size="xs" c="dimmed" truncate style={{ minWidth: 0 }}>
            {endpoint.nodeName} · {endpoint.host}:{endpoint.port}
          </Text>
        </Group>
        <Group gap={4} wrap="nowrap">
          {isMtproto && (
            <Tooltip label={t('userForm.mtprotoNoPerUserStats')} multiline w={280} position="left">
              <Badge variant="light" color="yellow" size="xs" style={{ cursor: 'help' }}>
                ⓘ
              </Badge>
            </Tooltip>
          )}
          <Tooltip label={tooltipLabel} multiline w={260}>
            <ActionIcon
              variant="light"
              size="sm"
              onClick={handleCopy}
              color={copied ? 'green' : hasUri ? 'blue' : 'grape'}
              style={{ flexShrink: 0 }}
              disabled={!hasUri && !wgconfUrl}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
