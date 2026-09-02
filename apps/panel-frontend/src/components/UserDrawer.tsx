import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Drawer, NumberInput, Select, Stack, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDeviceDesktop,
  IconDice5,
  IconEye,
  IconMail,
  IconPencil,
  IconPlus,
  IconRoute,
  IconTag,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import {
  ALL_SQUAD_ID,
  deleteHwidDevice,
  fetchUserEndpoints,
  listBindings,
  listNodes,
  listProfiles,
  listSquads,
  listUserDevices,
  listUsers,
  type CreateUserInput,
  type TrafficLimitStrategy,
  type UpdateUserInput,
  type User,
} from '../lib/api';
import { relativeTime } from '../lib/relativeTime';
import { ROUTING_PRESET_IDS, presetKey } from '../lib/routingPresets';

/**
 * Create / edit a user. A drawer rather than a modal: this is a form you fill
 * while still reading the roster behind it, and it is long enough that a
 * centred modal would fight the page for vertical space.
 *
 * The shape follows one idea: the operator answers three questions at the top
 * (which preset, what name, which squads) and immediately sees what that
 * produces in "What the client gets". Everything else is folded into Advanced,
 * because on most days it is left alone.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const SUNK = '#08101A';
const WELL = '#0B1420';
const BORDER_INPUT = '#2C3A4E';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';
const VIOLET_HI = '#C0AAF6';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

const LABEL = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: MIST,
  lineHeight: '12px',
};

const GiB = 1_073_741_824;

const STRATEGY_VALUES: TrafficLimitStrategy[] = ['no_reset', 'day', 'week', 'month', 'rolling'];

/**
 * Quick presets. Stored per browser rather than in the database: they are a
 * personal shortcut, the panel has no template table, and inventing one would
 * mean a migration for what is today one operator's muscle memory. Moving them
 * server-side later is additive.
 */
interface Preset {
  id: string;
  name: string;
  trafficGb: number | null;
  expireDays: number | null;
  strategy: TrafficLimitStrategy;
}

const PRESET_STORAGE_KEY = 'iceslab:user-presets';

const DEFAULT_PRESETS: Preset[] = [
  { id: 'basic', name: 'basic', trafficGb: 50, expireDays: 30, strategy: 'month' },
  { id: 'premium', name: 'premium', trafficGb: null, expireDays: 90, strategy: 'no_reset' },
  { id: 'trial', name: 'trial', trafficGb: 5, expireDays: 7, strategy: 'no_reset' },
];

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw) as Preset[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

interface FormValues {
  username: string;
  subscriptionToken: string;
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
  routingPreset: string;
}

function defaultValues(user: User | null): FormValues {
  return {
    username: user?.username ?? '',
    subscriptionToken: '',
    trafficLimitGb: user?.trafficLimitBytes != null ? Math.round(user.trafficLimitBytes / GiB) : '',
    trafficLimitStrategy: user?.trafficLimitStrategy ?? 'no_reset',
    expireDays: '',
    // limited/expired are cron-managed and rejected by UpdateUserSchema, so an
    // edit can only set active or disabled. Saving a limited user reactivates
    // them; the review cron re-limits if they are still over quota.
    status: user?.status === 'disabled' ? 'disabled' : 'active',
    description: user?.description ?? '',
    tag: user?.tag ?? '',
    email: user?.email ?? '',
    telegramId: user?.telegramId ?? '',
    hwidDeviceLimit: user?.hwidDeviceLimit ?? '',
    groupIds: user?.groupIds ?? [],
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

export function UserDrawer({ opened, onClose, user, onSubmit, loading }: Props) {
  const { t } = useTranslation();
  const isEdit = user !== null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const presets = useMemo(() => loadPresets(), [opened]);

  const form = useForm<FormValues>({
    initialValues: defaultValues(user),
    validate: {
      username: (v) => {
        if (isEdit) return null;
        if (v.length < 3) return t('validation.nameMin3');
        if (!/^[a-zA-Z0-9_-]+$/.test(v)) return t('validation.usernameLatinOnly');
        return null;
      },
      email: (v) =>
        v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? t('validation.emailInvalid') : null,
    },
  });

  useEffect(() => {
    if (opened) {
      form.setValues(defaultValues(user));
      setAdvancedOpen(false);
      setPresetId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, user?.id, user?.updatedAt]);

  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads, enabled: opened });
  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: opened,
  });
  const bindingsQuery = useQuery({
    queryKey: ['bindings'],
    queryFn: () => listBindings(),
    enabled: opened,
  });
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes(), enabled: opened });

  const squads = squadsQuery.data?.squads ?? [];

  // Username availability. There is no dedicated endpoint, so this reuses the
  // list search and compares exactly: a substring hit on another user must not
  // read as "taken". Only meaningful while creating.
  const nameProbe = form.values.username.trim();
  const nameQuery = useQuery({
    queryKey: ['username-probe', nameProbe],
    queryFn: () => listUsers({ search: nameProbe, limit: 10 }),
    enabled: opened && !isEdit && nameProbe.length >= 3,
    staleTime: 30_000,
  });
  const nameTaken =
    nameQuery.data?.users.some((u) => u.username.toLowerCase() === nameProbe.toLowerCase()) ?? false;
  const nameFree = !isEdit && nameProbe.length >= 3 && !nameQuery.isFetching && !nameTaken;

  /**
   * The real answer for a user who already exists: the endpoints endpoint runs
   * generateSubscription, the very pipeline behind /sub, so what shows here is
   * what will leave, by construction.
   *
   * This used to be recomputed in the browser from bindings, one row each, and
   * it drifted. That version knew nothing about hidden cascade exits, about an
   * entry fanning out into one config per direction and policy, about hosts
   * (a binding can have several or none), about a host being disabled, about a
   * squad narrowing hosts, or about disableForFormats. It reported "4 configs ·
   * 4 nodes" and named two nodes the client never receives directly.
   */
  const endpointsQuery = useQuery({
    queryKey: ['user-endpoints', user?.id],
    queryFn: () => fetchUserEndpoints(user!.id),
    enabled: opened && isEdit,
    staleTime: 30_000,
  });

  /**
   * The estimate for a user who does not exist yet. No id means nothing to ask
   * the server about, so squads to profiles to bindings is the best guess
   * available, and the block says so instead of presenting it as fact.
   */
  const estimate = useMemo(() => {
    const picked = form.values.groupIds.length > 0 ? form.values.groupIds : [ALL_SQUAD_ID];
    const profileIds = new Set<string>();
    for (const s of squads) {
      if (picked.includes(s.id)) for (const pid of s.profileIds) profileIds.add(pid);
    }
    const profileById = new Map((profilesQuery.data?.profiles ?? []).map((p) => [p.id, p]));
    const nodeById = new Map((nodesQuery.data?.nodes ?? []).map((n) => [n.id, n]));

    const rows: PreviewRowData[] = [];
    const nodeIds = new Set<string>();
    const protocols = new Set<string>();

    for (const b of bindingsQuery.data?.bindings ?? []) {
      if (!profileIds.has(b.profileId) || !b.enabled) continue;
      const node = nodeById.get(b.nodeId);
      const profile = profileById.get(b.profileId);
      if (!node || !profile) continue;
      nodeIds.add(node.id);
      protocols.add(profile.protocol);
      rows.push({
        key: b.id,
        title: node.name,
        protocol: profile.protocol,
        note: node.countryCode ? node.countryCode.toUpperCase() : null,
        online: node.status === 'online',
      });
    }

    return {
      rows,
      configs: rows.length,
      places: nodeIds.size,
      protocols: protocols.size,
      online: rows.filter((r) => r.online).length,
      estimate: true as const,
    };
  }, [form.values.groupIds, squads, profilesQuery.data, bindingsQuery.data, nodesQuery.data]);

  const preview: PreviewData = useMemo(() => {
    if (!isEdit) return estimate;
    const endpoints = endpointsQuery.data?.endpoints ?? [];
    // Joined by node id, never by name: one node hands out several lines under
    // different labels, so matching on the caption would match nothing at all.
    const nodeById = new Map((nodesQuery.data?.nodes ?? []).map((n) => [n.id, n]));
    const rows = endpoints.map((e, i) => ({
      key: `${e.uri.slice(0, 40)}#${i}`,
      // The caption the client will show, which is what an operator gets asked
      // about over support chat.
      title: e.label,
      protocol: e.protocol,
      note: String(e.port),
      online: nodeById.get(e.nodeId)?.status === 'online',
    }));
    return {
      rows,
      configs: rows.length,
      // Real nodes again, now that there is an id to count. Two endpoints on
      // one address with different ports are one node, and one address.
      places: new Set(endpoints.map((e) => e.nodeId)).size,
      protocols: new Set(endpoints.map((e) => e.protocol)).size,
      online: rows.filter((r) => r.online).length,
      estimate: false as const,
    };
  }, [isEdit, estimate, endpointsQuery.data, nodesQuery.data]);

  function applyPreset(p: Preset) {
    setPresetId(p.id);
    form.setFieldValue('trafficLimitGb', p.trafficGb ?? '');
    form.setFieldValue('expireDays', p.expireDays ?? '');
    form.setFieldValue('trafficLimitStrategy', p.strategy);
  }

  function toggleSquad(id: string) {
    const has = form.values.groupIds.includes(id);
    form.setFieldValue(
      'groupIds',
      has ? form.values.groupIds.filter((x) => x !== id) : [...form.values.groupIds, id],
    );
  }

  async function handleSubmit(values: FormValues) {
    if (isEdit) {
      const input: UpdateUserInput = {
        status: values.status,
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb) || null,
        trafficLimitStrategy: values.trafficLimitStrategy,
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit: values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds: values.groupIds,
        routingPreset: values.routingPreset ? (values.routingPreset as never) : null,
      };
      await onSubmit(input);
    } else {
      const input: CreateUserInput = {
        username: values.username.trim(),
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb) || null,
        trafficLimitStrategy: values.trafficLimitStrategy,
        expireDays: values.expireDays === '' ? null : Number(values.expireDays),
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit: values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds: values.groupIds,
        ...(values.subscriptionToken ? { subscriptionToken: values.subscriptionToken.trim() } : {}),
        ...(values.routingPreset ? { routingPreset: values.routingPreset as never } : {}),
      };
      await onSubmit(input);
    }
    onClose();
  }

  const expiresAt =
    form.values.expireDays === ''
      ? null
      : new Date(Date.now() + Number(form.values.expireDays) * 86_400_000);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={540}
      withCloseButton={false}
      padding={0}
      overlayProps={{ backgroundOpacity: 0.55, color: '#030810' }}
      styles={{ content: { backgroundColor: CARD, display: 'flex', flexDirection: 'column' } }}
    >
      <form
        onSubmit={form.onSubmit(handleSubmit)}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        {/* Header */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '22px 24px 18px',
            borderBottom: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
          }}
        >
          <Box style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Box
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: `${CYAN}1A`,
                border: `1px solid ${CYAN}33`,
                color: CYAN,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <IconUser size={18} stroke={1.8} />
            </Box>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Text
                style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 500, lineHeight: '22px', color: SNOW }}
              >
                {isEdit ? user.username : t('userDrawer.newTitle')}
              </Text>
              <Text
                style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.16em', lineHeight: '12px', color: MIST }}
              >
                {isEdit ? t('userDrawer.editSubtitle') : t('userDrawer.newSubtitle')}
              </Text>
            </Box>
          </Box>
          <UnstyledButton
            onClick={onClose}
            aria-label={t('common.cancel')}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: MIST,
            }}
          >
            <IconX size={16} stroke={1.8} />
          </UnstyledButton>
        </Box>

        {/* Body */}
        <Box style={{ flex: 1, overflowY: 'auto', padding: 24, minHeight: 0 }}>
          <Stack gap={20}>
            {!isEdit && (
              <Section label={t('userDrawer.preset')}>
                <Box style={{ display: 'flex', gap: 8, width: '100%' }}>
                  {presets.map((p) => {
                    const active = presetId === p.id;
                    return (
                      <UnstyledButton
                        key={p.id}
                        onClick={() => applyPreset(p)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          padding: '10px 12px',
                          borderRadius: 10,
                          backgroundColor: active ? `${CYAN}14` : CARD,
                          border: `1px solid ${active ? CYAN : HAIRLINE}`,
                        }}
                      >
                        <Text
                          style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}
                        >
                          {p.name}
                        </Text>
                        <Text
                          style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: active ? CYAN : MIST }}
                        >
                          {p.trafficGb === null ? '∞' : `${p.trafficGb} GB`}
                          {p.expireDays === null ? '' : ` · ${p.expireDays}d`}
                        </Text>
                      </UnstyledButton>
                    );
                  })}
                  <Box
                    title={t('userDrawer.presetAddHint')}
                    style={{
                      width: 44,
                      borderRadius: 10,
                      backgroundColor: CARD,
                      border: `1px dashed ${BORDER_INPUT}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: MIST,
                      flexShrink: 0,
                    }}
                  >
                    <IconPlus size={16} stroke={1.8} />
                  </Box>
                </Box>
              </Section>
            )}

            {/* Username: the one field that cannot be changed later, so it
                carries its own availability check while typing. */}
            {!isEdit && (
              <Section label={t('userDrawer.username')} required>
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 40,
                    padding: '0 12px',
                    borderRadius: 10,
                    backgroundColor: SUNK,
                    border: `1px solid ${form.errors.username ? RED : BORDER_INPUT}`,
                  }}
                >
                  <input
                    {...form.getInputProps('username')}
                    placeholder={t('userDrawer.usernamePlaceholder')}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: SNOW,
                      fontFamily: DISPLAY,
                      fontSize: 13,
                      lineHeight: '16px',
                    }}
                  />
                  {nameFree && (
                    <Box style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <IconCheck size={14} stroke={2.2} color={MOSS} />
                      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: MOSS }}>
                        {t('userDrawer.nameFree')}
                      </Text>
                    </Box>
                  )}
                  {nameTaken && (
                    <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: RED }}>
                      {t('userDrawer.nameTaken')}
                    </Text>
                  )}
                  <Box style={{ width: 1, height: 20, backgroundColor: HAIRLINE, flexShrink: 0 }} />
                  <UnstyledButton
                    title={t('userDrawer.generateName')}
                    onClick={() =>
                      form.setFieldValue('username', `user-${Math.random().toString(36).slice(2, 8)}`)
                    }
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: MIST,
                      flexShrink: 0,
                    }}
                  >
                    <IconDice5 size={15} stroke={1.8} />
                  </UnstyledButton>
                </Box>
                {form.errors.username && (
                  <Text style={{ fontSize: 11, color: RED, marginTop: 4 }}>{form.errors.username}</Text>
                )}
              </Section>
            )}

            <Section label={t('userDrawer.squads')}>
              <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {squads.map((s) => {
                  const active = form.values.groupIds.includes(s.id);
                  return (
                    <UnstyledButton
                      key={s.id}
                      onClick={() => toggleSquad(s.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        height: 32,
                        padding: '0 12px',
                        borderRadius: 8,
                        backgroundColor: active ? `${CYAN}14` : CARD,
                        border: `1px solid ${active ? CYAN : HAIRLINE}`,
                      }}
                    >
                      <Box
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          border: `1px solid ${active ? CYAN : DIM}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {active && <IconCheck size={8} stroke={3.4} color={CYAN} />}
                      </Box>
                      <Text
                        style={{
                          fontFamily: DISPLAY,
                          fontSize: 12,
                          lineHeight: '16px',
                          fontWeight: active ? 500 : 400,
                          color: active ? SNOW : MIST,
                        }}
                      >
                        {s.name}
                      </Text>
                    </UnstyledButton>
                  );
                })}
              </Box>
            </Section>

            <PreviewCard
              preview={preview}
              trafficGb={form.values.trafficLimitGb}
              strategy={form.values.trafficLimitStrategy}
              expiresAt={expiresAt}
              expireDays={form.values.expireDays}
              routingPreset={form.values.routingPreset}
              onEditTraffic={() => setAdvancedOpen(true)}
            />

            {/* Advanced: everything an operator leaves alone on a normal day. */}
            <Box
              style={{
                borderRadius: 10,
                backgroundColor: CARD,
                border: `1px solid ${HAIRLINE}`,
                overflow: 'hidden',
              }}
            >
              <UnstyledButton
                onClick={() => setAdvancedOpen((v) => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, color: MIST }}>
                  {advancedOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>
                    {t('userDrawer.advanced')}
                  </Text>
                </Box>
                <Text style={{ ...LABEL }}>
                  {advancedOpen ? t('userDrawer.hide') : t('userDrawer.show')}
                </Text>
              </UnstyledButton>

              {advancedOpen && (
                <Stack gap={20} style={{ padding: '4px 16px 18px' }}>
                  <AdvancedGroup icon={<IconMail size={13} />} title={t('userDrawer.contact')}>
                    <Box style={{ display: 'flex', gap: 12 }}>
                      <TextInput
                        style={{ flex: 1 }}
                        label={t('userDrawer.email')}
                        placeholder="user@example.com"
                        {...form.getInputProps('email')}
                      />
                      <TextInput
                        style={{ flex: 1 }}
                        label={t('userDrawer.telegram')}
                        placeholder={t('userDrawer.optional')}
                        {...form.getInputProps('telegramId')}
                      />
                    </Box>
                    <Hint>{t('userDrawer.telegramHint')}</Hint>
                  </AdvancedGroup>

                  <AdvancedGroup icon={<IconTag size={13} />} title={t('userDrawer.devicesAndTags')}>
                    <Box style={{ display: 'flex', gap: 12 }}>
                      <NumberInput
                        style={{ width: 150 }}
                        label={t('userDrawer.hwidLimit')}
                        min={0}
                        placeholder="3"
                        {...form.getInputProps('hwidDeviceLimit')}
                      />
                      <TextInput
                        style={{ flex: 1 }}
                        label={t('userDrawer.tag')}
                        placeholder="VIP / TRIAL / ..."
                        {...form.getInputProps('tag')}
                      />
                    </Box>
                    <Hint>{t('userDrawer.hwidHint')}</Hint>
                    {/* Only for a user who exists: devices are registered by a
                        client that has already connected. */}
                    {isEdit && user && (
                      <DeviceList userId={user.id} limit={form.values.hwidDeviceLimit} />
                    )}
                    <Textarea
                      label={t('userDrawer.note')}
                      placeholder={t('userDrawer.notePlaceholder')}
                      autosize
                      minRows={2}
                      {...form.getInputProps('description')}
                    />
                  </AdvancedGroup>

                  <AdvancedGroup icon={<IconRoute size={13} />} title={t('userDrawer.quota')}>
                    <Box style={{ display: 'flex', gap: 12 }}>
                      <NumberInput
                        style={{ width: 150 }}
                        label={t('userDrawer.trafficGb')}
                        min={0}
                        placeholder="∞"
                        {...form.getInputProps('trafficLimitGb')}
                      />
                      <Select
                        style={{ flex: 1 }}
                        label={t('userDrawer.resets')}
                        data={STRATEGY_VALUES.map((v) => ({
                          value: v,
                          label: t(`users.strategy.${v}`),
                        }))}
                        allowDeselect={false}
                        {...form.getInputProps('trafficLimitStrategy')}
                      />
                      {!isEdit && (
                        <NumberInput
                          style={{ width: 130 }}
                          label={t('userDrawer.expireDays')}
                          min={0}
                          placeholder="∞"
                          {...form.getInputProps('expireDays')}
                        />
                      )}
                    </Box>
                  </AdvancedGroup>

                  <AdvancedGroup icon={<IconRoute size={13} />} title={t('userDrawer.routingOverride')}>
                    <Select
                      // Built from the shared list the backend validates
                      // against, not from a copy of it.
                      data={[
                        { value: '', label: t('userDrawer.routingInherit') },
                        ...ROUTING_PRESET_IDS.map((id) => ({
                          value: id,
                          label: t(`metadata.preset${presetKey(id)}`),
                        })),
                      ]}
                      allowDeselect={false}
                      {...form.getInputProps('routingPreset')}
                    />
                    <Hint>{t('userDrawer.routingHint')}</Hint>
                  </AdvancedGroup>

                  {!isEdit && (
                    <AdvancedGroup
                      icon={<IconDeviceDesktop size={13} />}
                      title={t('userDrawer.migration')}
                      badge={t('userDrawer.rare')}
                    >
                      <TextInput
                        label={t('userDrawer.importToken')}
                        placeholder={`(${t('userDrawer.optional')})`}
                        {...form.getInputProps('subscriptionToken')}
                      />
                      <Hint>{t('userDrawer.importTokenHint')}</Hint>
                    </AdvancedGroup>
                  )}
                </Stack>
              )}
            </Box>
          </Stack>
        </Box>

        {/* Footer */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px 20px',
            backgroundColor: WELL,
            borderTop: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', color: MIST }}>
            ⏎ {isEdit ? t('userDrawer.saveShort') : t('userDrawer.createShort')}
          </Text>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FooterButton onClick={onClose}>{t('common.cancel')}</FooterButton>
            <FooterButton type="submit" primary disabled={loading}>
              {isEdit ? t('common.save') : t('userDrawer.create')}
            </FooterButton>
          </Box>
        </Box>
      </form>
    </Drawer>
  );
}

function Section({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <Text style={LABEL}>{label}</Text>
        {required && <Text style={{ ...LABEL, color: RED }}>*</Text>}
      </Box>
      {children}
    </Box>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: 11, lineHeight: '16px', color: MIST }}>{children}</Text>
  );
}

function AdvancedGroup({
  icon,
  title,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Box style={{ color: MIST, display: 'flex' }}>{icon}</Box>
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{title}</Text>
        {badge && (
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.1em',
              color: '#F5B14C',
              backgroundColor: '#F5B14C1A',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            {badge}
          </Text>
        )}
      </Box>
      {children}
    </Box>
  );
}

function FooterButton({
  children,
  onClick,
  type = 'button',
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <UnstyledButton
      component="button"
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 36,
        padding: '0 16px',
        borderRadius: 8,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {primary && <IconCheck size={14} stroke={2.4} color={CYAN} />}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          color: primary ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}

/**
 * The devices holding this user's HWID slots, and the way to free one.
 *
 * Lost when the form moved from a modal to this drawer, which left the limit
 * above it answering half a question: an operator told "3 of 3, reset one"
 * could see the 3 and nothing to act on. The count against the limit is the
 * point of the block, the list is what makes it actionable.
 */
function DeviceList({ userId, limit }: { userId: string; limit: number | '' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ['user-devices', userId],
    queryFn: () => listUserDevices(userId),
    staleTime: 30_000,
  });
  const resetMutation = useMutation({
    mutationFn: (id: string) => deleteHwidDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-devices', userId] });
      notifications.show({ color: 'green', message: t('userDrawer.deviceReset') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const devices = devicesQuery.data?.devices ?? [];
  const used = devices.length;
  const cap = limit === '' ? null : Number(limit);
  const full = cap !== null && cap > 0 && used >= cap;

  return (
    <Box
      style={{
        borderRadius: 8,
        border: `1px solid ${HAIRLINE}`,
        backgroundColor: SUNK,
        padding: '10px 12px',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: devices.length ? 8 : 0 }}>
        <IconDeviceDesktop size={13} stroke={1.8} color={full ? RED : MIST} />
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{t('userDrawer.devices')}</Text>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 10, color: full ? RED : MIST }}>
          {cap === null
            ? t('userDrawer.devicesCounterNoLimit', { used })
            : t('userDrawer.devicesCounter', { used, limit: cap })}
        </Text>
      </Box>

      {devicesQuery.isLoading && (
        <Text style={{ fontSize: 11, color: MIST }}>{t('common.loading')}</Text>
      )}
      {devicesQuery.isError && (
        <Text style={{ fontSize: 11, color: RED }}>{t('userDrawer.devicesError')}</Text>
      )}

      <Stack gap={5}>
        {devices.map((d) => (
          <Box
            key={d.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 9px',
              borderRadius: 6,
              backgroundColor: WELL,
            }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: DISPLAY,
                fontSize: 12,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              // The full hwid is what the client actually sent, and it is the
              // only way to tell two unlabelled devices apart.
              title={d.hwid}
            >
              {d.label ?? `${d.hwid.slice(0, 12)}…`}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST, flexShrink: 0 }}>
              {relativeTime(d.lastSeenAt, t).text}
            </Text>
            <UnstyledButton
              onClick={() => resetMutation.mutate(d.id)}
              disabled={resetMutation.isPending}
              title={t('userDrawer.deviceResetHint')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: 5,
                border: `1px solid ${HAIRLINE}`,
                color: MIST,
                flexShrink: 0,
              }}
            >
              <IconX size={12} stroke={2.2} />
            </UnstyledButton>
          </Box>
        ))}
      </Stack>

      {!devicesQuery.isLoading && !devicesQuery.isError && devices.length === 0 && (
        // Empty is the normal starting state, not a fault: a device row appears
        // the first time a client sends its identifier, and never before.
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>
          {t('userDrawer.devicesEmpty')}
        </Text>
      )}
      {full && devices.length > 0 && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: RED, marginTop: 8 }}>
          {t('userDrawer.devicesFull')}
        </Text>
      )}
    </Box>
  );
}

interface PreviewRowData {
  key: string;
  /** What the client will show for this line. */
  title: string;
  protocol: string;
  /** Country for the estimate, port for the real thing. */
  note: string | null;
  online: boolean;
}

interface PreviewData {
  rows: PreviewRowData[];
  configs: number;
  /** Distinct nodes behind those configs. */
  places: number;
  protocols: number;
  online: number;
  /** Guessed from bindings because the user has no id yet. */
  estimate: boolean;
}

/**
 * The answer to "what did I just build for this person". Derived, never
 * entered: for an existing user it is the subscription itself, for a draft it
 * is a guess that says so.
 */
function PreviewCard({
  preview,
  trafficGb,
  strategy,
  expiresAt,
  expireDays,
  routingPreset,
  onEditTraffic,
}: {
  preview: PreviewData;
  trafficGb: number | '';
  strategy: TrafficLimitStrategy;
  expiresAt: Date | null;
  expireDays: number | '';
  routingPreset: string;
  onEditTraffic: () => void;
}) {
  const { t } = useTranslation();
  const shown = preview.rows.slice(0, 3);

  return (
    <Box
      style={{
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        padding: 16,
      }}
    >
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconEye size={16} stroke={1.8} color={CYAN} />
          <Text style={{ ...LABEL, letterSpacing: '0.16em' }}>{t('userDrawer.previewTitle')}</Text>
        </Box>
        {preview.configs > 0 && (
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: MOSS }} />
            <Text style={{ fontFamily: MONO, fontSize: 10, color: MOSS }}>
              {preview.online}/{preview.configs} {t('userDrawer.online')}
            </Text>
          </Box>
        )}
      </Box>

      {/* Each label is pluralised on its own number: "1 конфиг" against
          "4 конфига" against "6 конфигов". */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <Count
          value={preview.configs}
          label={t('userDrawer.configs', { count: preview.configs })}
        />
        <Text style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>·</Text>
        <Count value={preview.places} label={t('userDrawer.nodes', { count: preview.places })} />
        <Text style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>·</Text>
        <Count
          value={preview.protocols}
          label={t('userDrawer.protocols', { count: preview.protocols })}
        />
      </Box>

      <Stack gap={6}>
        {shown.length === 0 && (
          <Text style={{ fontSize: 12, color: MIST }}>{t('userDrawer.previewEmpty')}</Text>
        )}
        {shown.map((r) => (
          <Box
            key={r.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 6,
              backgroundColor: WELL,
            }}
          >
            <Box
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: r.online ? MOSS : MIST,
                flexShrink: 0,
              }}
            />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: DISPLAY,
                fontSize: 12,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.title}
            </Text>
            <ProtocolChip protocol={r.protocol} />
            {r.note && (
              <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST }}>{r.note}</Text>
            )}
          </Box>
        ))}
        {preview.rows.length > shown.length && (
          <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST }}>
            {t('userDrawer.andMore', { count: preview.rows.length - shown.length })}
          </Text>
        )}
        {/* A guess has to admit it. Presented as fact, this block was believed
            over the subscription it disagreed with. */}
        {preview.estimate && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>
            {t('userDrawer.previewEstimate')}
          </Text>
        )}
      </Stack>

      <Box style={{ height: 1, backgroundColor: HAIRLINE, margin: '14px 0 12px' }} />

      <Stack gap={8}>
        <PreviewRow
          label={t('userDrawer.traffic')}
          value={trafficGb === '' ? '∞' : `${trafficGb} GiB`}
          note={t(`users.strategy.${strategy}`)}
          onEdit={onEditTraffic}
        />
        <PreviewRow
          label={t('userDrawer.expires')}
          value={
            expiresAt
              ? expiresAt.toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : '∞'
          }
          note={expireDays === '' ? undefined : t('userDrawer.inDays', { count: Number(expireDays) })}
          onEdit={onEditTraffic}
        />
        <PreviewRow
          label={t('userDrawer.routing')}
          value={routingPreset || t('userDrawer.inheritsSquad')}
        />
      </Stack>
    </Box>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <>
      <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: SNOW }}>{value}</Text>
      <Text style={{ fontFamily: MONO, fontSize: 12, color: MIST }}>{label}</Text>
    </>
  );
}

function PreviewRow({
  label,
  value,
  note,
  onEdit,
}: {
  label: string;
  value: string;
  note?: string;
  onEdit?: () => void;
}) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: MIST }}>
        {label}
      </Text>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW }}>{value}</Text>
        {note && <Text style={{ fontFamily: DISPLAY, fontSize: 11, color: MIST }}>{note}</Text>}
        {onEdit && (
          <UnstyledButton onClick={onEdit} style={{ display: 'flex', color: MIST }}>
            <IconPencil size={13} stroke={1.8} />
          </UnstyledButton>
        )}
      </Box>
    </Box>
  );
}

function ProtocolChip({ protocol }: { protocol: string }) {
  // AmneziaWG gets the violet slot: it is the one protocol that is not an
  // xray-family inbound, and operators pick it for a different reason.
  const isWg = protocol.toLowerCase().includes('amnezia') || protocol.toLowerCase() === 'awg';
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        padding: '0 7px',
        borderRadius: 6,
        backgroundColor: isWg ? `${VIOLET}29` : `${CYAN}24`,
      }}
    >
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: isWg ? VIOLET_HI : CYAN,
          textTransform: 'uppercase',
        }}
      >
        {protocol}
      </Text>
    </Box>
  );
}
