import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import type { RoutingPresetId } from '@iceslab/shared';
import {
  IconBolt,
  IconCheck,
  IconLink,
  IconRoute,
  IconSearch,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import { ALL_SQUAD_ID, type RoutePolicy } from '@/lib/domain/routePolicies';
import { type Cascade } from '@/lib/domain/cascades';
import { type CreateSquadInput, type Squad, type UpdateSquadInput } from '@/lib/domain/squads';
import { type Profile } from '@/lib/domain/profiles';
import { ROUTING_PRESET_IDS, presetKey } from '@/lib/domain/routingPresets';
import { protocolLabelCompact } from '@/lib/domain/protocols';
import { engineWord } from '@/lib/domain/engines';

const PROTOCOL_COLORS: Record<string, string> = {
  hysteria: 'blue',
  xray: 'violet',
  amneziawg: 'teal',
  naive: 'orange',
  shadowsocks: 'pink',
  mtproto: 'cyan',
  mieru: 'grape',
};

interface FormValues {
  name: string;
  description: string;
  // R3-a - '' = inherit the panel-wide routing preset.
  routingPreset: string;
  // K7 - '' = no squad HWID default.
  hwidDeviceLimit: number | '';
  profileIds: string[];
  // A4 increment 2 - cascadeId -> allowed exit nodeIds. Empty/absent = no
  // restriction (member sees all exits of that balancer cascade).
  exitAcl: Record<string, string[]>;
  // A4 ad-split - extra route-policies granted to this squad (ids). Plain is
  // always available; empty = plain only.
  policyIds: string[];
}

function defaultValues(squad: Squad | null): FormValues {
  return {
    name: squad?.name ?? '',
    description: squad?.description ?? '',
    routingPreset: squad?.routingPreset ?? '',
    hwidDeviceLimit: squad?.hwidDeviceLimit ?? '',
    profileIds: squad?.profileIds ?? [],
    exitAcl: Object.fromEntries((squad?.exitAcl ?? []).map((e) => [e.cascadeId, e.exitNodeIds])),
    policyIds: squad?.policyIds ?? [],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  squad: Squad | null;
  /** Slice 27 - squad ACL operates on profiles, not per-node inbounds. */
  profiles: Profile[];
  /** Optional: count of bindings per profile, for the "deployed on N nodes"
   *  hint in each row. Computed by parent from listBindings(). */
  bindingsByProfile?: Map<string, number>;
  /** A4 increment 2 - balancer cascades whose exits this squad can restrict.
   *  Parent passes listCascades(); we filter to balancer cascades with exits. */
  cascades?: Cascade[];
  /** A4 ad-split - extra route-policies (ordinal >= 1) the squad can grant. */
  routePolicies?: RoutePolicy[];
  onSubmit: (input: CreateSquadInput | UpdateSquadInput) => Promise<void>;
  loading?: boolean;
}

export function SquadFormModal({
  opened,
  onClose,
  squad,
  profiles,
  bindingsByProfile,
  cascades,
  routePolicies,
  onSubmit,
  loading,
}: Props) {
  const { t } = useTranslation();
  const isEdit = squad !== null;
  const isAllSquad = squad?.id === ALL_SQUAD_ID;
  const [search, setSearch] = useState('');

  const form = useForm<FormValues>({
    initialValues: defaultValues(squad),
    validate: {
      name: (v) =>
        v.length < 1 || !/^[A-Za-z0-9 _-]+$/.test(v)
          ? t('validation.squadNameAllowed')
          : null,
    },
  });

  if (opened && squad && form.values.name !== squad.name) {
    form.setValues(defaultValues(squad));
  }

  // Group profiles by protocol so admin can quickly toggle whole protocol
  // families. Search filters at the profile level.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = profiles.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.protocol.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      );
    });
    const byProto = new Map<string, Profile[]>();
    for (const p of filtered) {
      const list = byProto.get(p.protocol) ?? [];
      list.push(p);
      byProto.set(p.protocol, list);
    }
    return Array.from(byProto.entries())
      .map(([protocol, list]) => ({
        protocol,
        profiles: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.protocol.localeCompare(b.protocol));
  }, [profiles, search]);

  // A4 increment 2 - balancer cascades that actually have exits to restrict.
  const balancerCascades = useMemo(
    () =>
      (cascades ?? []).filter(
        (c) => c.mode === 'balancer' && c.hops.some((h) => h.position > 0),
      ),
    [cascades],
  );

  async function handleSubmit(values: FormValues) {
    // Drop cascades with no chosen exits: an empty list = "no restriction".
    const exitAcl = Object.entries(values.exitAcl)
      .filter(([, ids]) => ids.length > 0)
      .map(([cascadeId, exitNodeIds]) => ({ cascadeId, exitNodeIds }));
    const base = {
      name: values.name,
      description: values.description.trim() || null,
      routingPreset: (values.routingPreset as RoutingPresetId) || null,
      hwidDeviceLimit: values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
      profileIds: values.profileIds,
      exitAcl,
      policyIds: values.policyIds,
    };
    if (isEdit) {
      await onSubmit(base satisfies UpdateSquadInput);
    } else {
      await onSubmit(base satisfies CreateSquadInput);
    }
    onClose();
    form.reset();
    setSearch('');
  }

  function toggleProfile(id: string) {
    if (isAllSquad) return;
    const cur = form.values.profileIds;
    form.setFieldValue(
      'profileIds',
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  // A4 ad-split - toggle a granted route-policy for this squad.
  function togglePolicy(policyId: string) {
    if (isAllSquad) return;
    const cur = form.values.policyIds;
    form.setFieldValue(
      'policyIds',
      cur.includes(policyId) ? cur.filter((x) => x !== policyId) : [...cur, policyId],
    );
  }

  // A4 increment 2 - toggle one exit node in one cascade's allow-list.
  function toggleExit(cascadeId: string, nodeId: string) {
    if (isAllSquad) return;
    const cur = form.values.exitAcl[cascadeId] ?? [];
    const next = cur.includes(nodeId) ? cur.filter((x) => x !== nodeId) : [...cur, nodeId];
    form.setFieldValue('exitAcl', { ...form.values.exitAcl, [cascadeId]: next });
  }

  function toggleAllInGroup(list: Profile[]) {
    if (isAllSquad) return;
    const ids = list.map((p) => p.id);
    const cur = new Set(form.values.profileIds);
    const allSelected = ids.every((id) => cur.has(id));
    if (allSelected) {
      for (const id of ids) cur.delete(id);
    } else {
      for (const id of ids) cur.add(id);
    }
    form.setFieldValue('profileIds', Array.from(cur));
  }

  const selectedCount = form.values.profileIds.length;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        setSearch('');
        onClose();
      }}
      title={
        <Group gap="sm" align="center">
          <Card
            p={8}
            radius="md"
            style={{
              backgroundColor: '#A78BFA1A',
              border: '1px solid #A78BFA33',
              color: '#A78BFA',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconLink size={18} />
          </Card>
          <Stack gap={2}>
            <Text style={{ fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
              {isEdit ? squad?.name ?? t('squads.form.titleEdit') : t('modal.squadNewTitle')}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isEdit ? t('modal.squadEditSubtitle') : t('modal.squadNewSubtitle')}
            </Text>
          </Stack>
        </Group>
      }
      size="lg"
      padding="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          {isEdit && squad && (
            <Card
              withBorder
              padding="md"
              radius="md"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: isAllSquad
                  ? 'var(--mantine-color-teal-6)'
                  : 'var(--mantine-color-indigo-6)',
              }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm">
                  <ThemeIcon
                    size={40}
                    radius="md"
                    variant="light"
                    color={isAllSquad ? 'teal' : 'indigo'}
                  >
                    <IconLink size={20} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Group gap={6}>
                      <Text fw={700}>{squad.name}</Text>
                      {isAllSquad && (
                        <Tooltip label={t('squads.form.systemSquadTooltip')}>
                          <IconShieldLock
                            size={13}
                            color="var(--mantine-color-yellow-6)"
                          />
                        </Tooltip>
                      )}
                    </Group>
                    {squad.description && (
                      <Text size="xs" c="dimmed">
                        {squad.description}
                      </Text>
                    )}
                  </Stack>
                </Group>
                <Group gap="xs">
                  <Tooltip label={t('squads.form.profilesSelectedBadge')}>
                    <Badge variant="light" color="indigo" leftSection={<IconBolt size={11} />}>
                      {selectedCount}
                    </Badge>
                  </Tooltip>
                  <Tooltip label={t('squads.form.membersBadge')}>
                    <Badge variant="light" color="blue" leftSection={<IconUsers size={11} />}>
                      {squad.memberCount}
                    </Badge>
                  </Tooltip>
                </Group>
              </Group>
            </Card>
          )}

          {isAllSquad && (
            <Alert color="yellow" icon={<IconShieldLock size={18} />}>
              {t('squads.form.allAlert')}
            </Alert>
          )}

          <TextInput
            label={t('squads.form.name')}
            placeholder={t('squads.form.namePlaceholder')}
            required
            disabled={isAllSquad}
            {...form.getInputProps('name')}
          />
          <Textarea
            label={t('squads.form.description')}
            placeholder={t('squads.form.descriptionPlaceholder')}
            autosize
            minRows={2}
            disabled={isAllSquad}
            {...form.getInputProps('description')}
          />
          {/* R3-a - per-squad routing override. '' = inherit panel default. */}
          <Select
            label={t('squads.form.routing')}
            description={t('squads.form.routingDesc')}
            disabled={isAllSquad}
            // Built from the shared list the backend validates against. The
            // labels come from one place too, so the same preset is not named
            // two ways on two screens.
            data={[
              { value: '', label: t('squads.form.routingInherit') },
              ...ROUTING_PRESET_IDS.map((id) => ({
                value: id,
                label: t(`metadata.preset${presetKey(id)}`),
              })),
            ]}
            allowDeselect={false}
            {...form.getInputProps('routingPreset')}
          />
          {/* K7 - per-squad HWID device-limit default (used when a user has no
              explicit limit; max across the user's squads wins). */}
          <NumberInput
            label={t('squads.form.hwidLimit')}
            description={t('squads.form.hwidLimitDesc')}
            placeholder={t('squads.form.hwidLimitPlaceholder')}
            min={1}
            max={100}
            allowDecimal={false}
            allowNegative={false}
            disabled={isAllSquad}
            {...form.getInputProps('hwidDeviceLimit')}
          />

          <Divider
            label={
              <Group gap={6}>
                <Text size="sm" fw={600}>
                  {t('squads.form.profiles')}
                </Text>
                <Badge size="sm" variant="light" color="indigo">
                  {t('squads.form.profilesSelected', { count: selectedCount })}
                </Badge>
              </Group>
            }
            labelPosition="left"
          />

          {!isAllSquad && (
            <TextInput
              placeholder={t('squads.form.profilesSearch')}
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          )}

          <Stack gap="sm" mah={520} style={{ overflowY: 'auto', paddingRight: 4 }}>
            {grouped.length === 0 ? (
              <Paper withBorder p="md" radius="sm" ta="center">
                <Text c="dimmed" size="sm">
                  {profiles.length === 0
                    ? t('squads.form.profilesEmpty')
                    : t('squads.form.profilesNothingFound')}
                </Text>
              </Paper>
            ) : (
              grouped.map((g) => (
                <ProtocolGroup
                  key={g.protocol}
                  protocol={g.protocol}
                  profiles={g.profiles}
                  selectedIds={new Set(form.values.profileIds)}
                  bindingsByProfile={bindingsByProfile}
                  disabled={isAllSquad}
                  onToggle={toggleProfile}
                  onToggleAll={() => toggleAllInGroup(g.profiles)}
                />
              ))
            )}
          </Stack>

          {/* A4 increment 2 - per-cascade exit allow-list. None checked = the
              member sees ALL exits of that balancer (opt-in restriction). */}
          {!isAllSquad && balancerCascades.length > 0 && (
            <>
              <Divider
                label={
                  <Text size="sm" fw={600}>
                    {t('squads.form.exitAcl')}
                  </Text>
                }
                labelPosition="left"
              />
              <Text size="xs" c="dimmed">
                {t('squads.form.exitAclHint')}
              </Text>
              <Stack gap="sm">
                {balancerCascades.map((c) => {
                  const exits = c.hops.filter((h) => h.position > 0);
                  const sel = new Set(form.values.exitAcl[c.id] ?? []);
                  return (
                    <Box
                      key={c.id}
                      style={{
                        border: '1px solid var(--mantine-color-dark-4)',
                        borderLeft: '3px solid var(--mantine-color-violet-6)',
                        borderRadius: 'var(--mantine-radius-md)',
                        padding: 'var(--mantine-spacing-sm)',
                        background: 'var(--mantine-color-dark-7)',
                      }}
                    >
                      <Group gap="sm" wrap="nowrap" mb="sm">
                        <ThemeIcon variant="light" color="violet" size="md">
                          <IconRoute size={14} />
                        </ThemeIcon>
                        <Text size="sm" fw={700} style={{ flex: 1 }}>
                          {c.name}
                        </Text>
                        <Badge variant="light" color={sel.size === 0 ? 'teal' : 'violet'} size="sm">
                          {sel.size === 0
                            ? t('squads.form.exitAclAll')
                            : `${sel.size}/${exits.length}`}
                        </Badge>
                      </Group>
                      <Stack gap={4}>
                        {exits.map((h) => {
                          const checked = sel.has(h.nodeId);
                          return (
                            <Group
                              key={h.nodeId}
                              justify="space-between"
                              wrap="nowrap"
                              onClick={() => toggleExit(c.id, h.nodeId)}
                              px="sm"
                              py={8}
                              style={{
                                cursor: 'pointer',
                                borderRadius: 6,
                                background: checked
                                  ? 'var(--mantine-color-dark-5)'
                                  : 'var(--mantine-color-dark-6)',
                                minHeight: 38,
                              }}
                            >
                              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                                <Checkbox checked={checked} readOnly tabIndex={-1} />
                                <Text size="sm" fw={500} truncate>
                                  {h.nodeName}
                                </Text>
                              </Group>
                            </Group>
                          );
                        })}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </>
          )}

          {/* A4 ad-split - route-policy grants. Plain profile is always available;
              checked = this squad also offers that policy (e.g. "Без рекламы"). */}
          {!isAllSquad && (routePolicies?.length ?? 0) > 0 && (
            <>
              <Divider
                label={
                  <Text size="sm" fw={600}>
                    {t('squads.form.policies')}
                  </Text>
                }
                labelPosition="left"
              />
              <Text size="xs" c="dimmed">
                {t('squads.form.policiesHint')}
              </Text>
              <Stack gap={4}>
                {routePolicies!.map((p) => {
                  const checked = form.values.policyIds.includes(p.id);
                  return (
                    <Group
                      key={p.id}
                      justify="space-between"
                      wrap="nowrap"
                      onClick={() => togglePolicy(p.id)}
                      px="sm"
                      py={8}
                      style={{
                        cursor: 'pointer',
                        borderRadius: 6,
                        background: checked
                          ? 'var(--mantine-color-dark-5)'
                          : 'var(--mantine-color-dark-6)',
                        minHeight: 38,
                      }}
                    >
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                        <Checkbox checked={checked} readOnly tabIndex={-1} />
                        <Text size="sm" fw={500} truncate>
                          {p.name}
                        </Text>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            </>
          )}

          <Divider />

          <Group justify="space-between" gap="sm">
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isAllSquad
                ? t('modal.shortcutBuiltin')
                : isEdit
                  ? t('modal.shortcutSave')
                  : t('modal.shortcutCreate')}
            </Text>
            <Group gap="sm">
              <Button variant="default" onClick={onClose} disabled={loading}>
                {isAllSquad ? t('common.close') : t('common.cancel')}
              </Button>
              {!isAllSquad && (
                <Button
                  type="submit"
                  loading={loading}
                  leftSection={<IconCheck size={16} />}
                  style={{ backgroundColor: '#2A93D1', color: '#08101A', fontWeight: 500 }}
                >
                  {isEdit ? t('squads.form.submitEdit') : t('squads.form.submitCreate')}
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ───── Per-protocol group ─────

function ProtocolGroup({
  protocol,
  profiles,
  selectedIds,
  bindingsByProfile,
  disabled,
  onToggle,
  onToggleAll,
}: {
  protocol: string;
  profiles: Profile[];
  selectedIds: Set<string>;
  bindingsByProfile?: Map<string, number>;
  disabled?: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const { t } = useTranslation();
  const ids = profiles.map((p) => p.id);
  const allSelected = ids.every((id) => selectedIds.has(id));
  const someSelected = ids.some((id) => selectedIds.has(id));
  const color = PROTOCOL_COLORS[protocol] ?? 'gray';

  return (
    // Plain Box with border instead of Card - Card's internal grid + the
    // borderLeft style override makes content overflow the bottom edge by
    // ~3-4px in Mantine 7.x. Box gives full control over padding.
    <Box
      style={{
        border: '1px solid var(--mantine-color-dark-4)',
        borderLeft: `3px solid var(--mantine-color-${color}-6)`,
        borderRadius: 'var(--mantine-radius-md)',
        padding: 'var(--mantine-spacing-sm)',
        background: 'var(--mantine-color-dark-7)',
      }}
    >
      <Group gap="sm" wrap="nowrap" mb="sm">
        <ThemeIcon variant="light" color={color} size="md">
          <IconBolt size={14} />
        </ThemeIcon>
        <Text size="sm" fw={700} tt="uppercase" style={{ flex: 1, letterSpacing: 0.5 }}>
          {protocolLabelCompact(protocol)}
        </Text>
        <Badge
          variant="light"
          color={allSelected ? 'teal' : 'gray'}
          size="sm"
        >
          {ids.filter((id) => selectedIds.has(id)).length}/{ids.length}
        </Badge>
        <Tooltip label={allSelected ? t('squadForm.deselectAll') : t('squadForm.selectAll')}>
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            disabled={disabled}
            onChange={onToggleAll}
          />
        </Tooltip>
      </Group>

      <Stack gap={4}>
        {profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            checked={selectedIds.has(p.id)}
            bindingCount={bindingsByProfile?.get(p.id) ?? p.bindingCount}
            disabled={disabled}
            onToggle={() => onToggle(p.id)}
          />
        ))}
      </Stack>
    </Box>
  );
}

function ProfileRow({
  profile,
  checked,
  bindingCount,
  disabled,
  onToggle,
}: {
  profile: Profile;
  checked: boolean;
  bindingCount: number;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  // Plain Group wrapped in a borderless container - nesting Paper inside
  // Card creates overflow clipping in Mantine 7.x because both wrap content
  // in `position: relative` boxes and the inner Stack ends up taller than
  // the parent Card thinks it is. Flat row keeps the same UX without the
  // visual artifacts.
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      onClick={disabled ? undefined : onToggle}
      px="sm"
      py={8}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        borderRadius: 6,
        background: checked
          ? 'var(--mantine-color-dark-5)'
          : 'var(--mantine-color-dark-6)',
        transition: 'background 0.1s',
        minHeight: 38,
      }}
    >
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        <Checkbox checked={checked} disabled={disabled} readOnly tabIndex={-1} />
        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={500} truncate>
              {profile.name}
            </Text>
            {/* The heading above groups by PROTOCOL, so two profiles served by
                different cores sit under one word. The engine belongs on the
                row, which is the only place they differ. */}
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {engineWord(profile.effectiveEngine, t)}
            </Text>
            {!profile.enabled && (
              <Badge variant="default" color="gray" size="xs">
                {t('squadForm.profileOffBadge')}
              </Badge>
            )}
          </Group>
          {profile.description && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {profile.description}
            </Text>
          )}
        </Stack>
      </Group>
      <Tooltip label={t('squadForm.deployedTooltip')}>
        <Badge variant="outline" color="gray" size="sm">
          {bindingCount}
        </Badge>
      </Tooltip>
    </Group>
  );
}
