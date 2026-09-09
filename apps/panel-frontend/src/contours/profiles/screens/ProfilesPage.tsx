import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Group,
  Menu,
  Select,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBolt,
  IconCheck,
  IconFilter,
  IconDotsVertical,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer2,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import {
  createProfile,
  deleteProfile,
  listBindings,
  listProfiles,
  updateProfile,
  type CreateProfileInput,
  type Profile,
  type UpdateProfileInput,
} from '@/lib/domain/profiles';
import { type ProtocolName } from '@/lib/domain/protocols';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { ProfileFormModal } from '@/contours/profiles/components/ProfileFormModal';
import { DeployProfileModal } from '@/contours/profiles/components/DeployProfileModal';
import { TestConnectModal } from '@/contours/profiles/components/TestConnectModal';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const VIOLET = '#A78BFA';
const PURPLE = '#C78BFA';
const PINK = '#F5A3B8';
const CYAN2 = '#67E8F9';

const PROTOCOL_ACCENT: Record<string, string> = {
  hysteria: CYAN,
  xray: VIOLET,
  amneziawg: MOSS,
  naive: AMBER,
  shadowsocks: PINK,
  mtproto: CYAN2,
  mieru: PURPLE,
};

const PROTOCOL_LABELS: Record<string, string> = {
  hysteria: 'Hysteria 2',
  xray: 'Xray REALITY',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  shadowsocks: 'Shadowsocks',
  mtproto: 'MTProto',
  mieru: 'Mieru',
};

export function ProfilesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Create and edit moved to /profiles/:id; the modal stays mounted only for
  // flows that still open it in place.
  const [createOpen, { close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deploying, setDeploying] = useState<Profile | null>(null);
  const [testing, setTesting] = useState<Profile | null>(null);
  const [search, setSearch] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<ProtocolName | 'all'>('all');

  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() });
  const bindingsQuery = useQuery({ queryKey: ['bindings'], queryFn: () => listBindings() });

  const bindingsByProfile = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      m.set(b.profileId, (m.get(b.profileId) ?? 0) + 1);
    }
    return m;
  }, [bindingsQuery.data]);

  // The crumb carries what this page counts: how many templates exist, and how
  // many distinct protocols are actually deployed rather than merely defined.
  const allProfiles = profilesQuery.data?.profiles ?? [];
  usePageMeta([
    t('pageMeta.profiles', { count: allProfiles.length }),
    t('pageMeta.profileProtocols', {
      count: new Set(
        allProfiles
          .filter((p) => (bindingsByProfile.get(p.id) ?? p.bindingCount) > 0)
          .map((p) => p.protocol),
      ).size,
    }),
  ]);

  const createMutation = useMutation({
    mutationFn: createProfile,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['bindings'] });
      notifications.show({
        color: 'green',
        message: t('profiles.notify.createdOpenDeploy'),
      });
      setDeploying(created);
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProfileInput }) =>
      updateProfile(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      notifications.show({ color: 'green', message: t('profiles.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['bindings'] });
      notifications.show({ color: 'green', message: t('profiles.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(profile: Profile) {
    const bindings = bindingsByProfile.get(profile.id) ?? 0;
    modals.openConfirmModal({
      title: t('profiles.deleteTitle', { name: profile.name }),
      children: (
        <Text size="sm">
          {bindings > 0
            ? t('profiles.deleteWithBindings', { count: bindings })
            : t('profiles.deleteSafe')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(profile.id),
    });
  }

  const profiles = profilesQuery.data?.profiles ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (protocolFilter !== 'all' && p.protocol !== protocolFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [profiles, search, protocolFilter]);

  return (
    <Stack gap="lg">
      {/* Page bar: what the library holds, then search, then the filter and
          the one action. Same strip as every other list page. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 56,
          padding: '8px 8px 8px 14px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, paddingRight: 16 }}>
          <Box
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: `${CYAN}1A`,
              border: `1px solid ${CYAN}33`,
              color: CYAN,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconBolt size={16} stroke={1.8} />
          </Box>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarFact value={profiles.length} label={t('profiles.bar.profiles')} />
            <BarDot />
            <BarFact
              value={profiles.filter((p) => (bindingsByProfile.get(p.id) ?? p.bindingCount) > 0).length}
              label={t('profiles.bar.inUse')}
              accent={MOSS}
            />
            {profiles.some((p) => (bindingsByProfile.get(p.id) ?? p.bindingCount) === 0) && (
              <>
                <BarDot />
                <BarFact
                  value={
                    profiles.filter((p) => (bindingsByProfile.get(p.id) ?? p.bindingCount) === 0)
                      .length
                  }
                  label={t('profiles.bar.unused')}
                  accent={AMBER}
                />
              </>
            )}
          </Box>
        </Box>

        <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
          <IconSearch size={15} stroke={1.8} color={MIST} />
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder={t('profiles.searchPlaceholder')}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: SNOW,
              fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 13,
            }}
          />
        </Box>

        <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, flexShrink: 0 }}>
          {/* The filter carries the inventory: each protocol shows its own dot
              and how many profiles use it, so an empty protocol is visible
              before you select it and find nothing. */}
          <Select
            value={protocolFilter}
            onChange={(v) => setProtocolFilter((v as ProtocolName | 'all') ?? 'all')}
            allowDeselect={false}
            w={190}
            leftSection={<IconFilter size={14} stroke={1.8} color={CYAN} />}
            leftSectionWidth={32}
            comboboxProps={{ withinPortal: true }}
            data={[
              { value: 'all', label: t('profiles.allProtocols') },
              ...(Object.keys(PROTOCOL_LABELS) as ProtocolName[]).map((p) => ({
                value: p,
                label: PROTOCOL_LABELS[p],
              })),
            ]}
            renderOption={({ option, checked }) => {
              const isAll = option.value === 'all';
              const accent = isAll ? SNOW : (PROTOCOL_ACCENT[option.value] ?? MIST);
              const count = isAll
                ? profiles.length
                : profiles.filter((p) => p.protocol === option.value).length;
              return (
                <Group gap={10} wrap="nowrap" style={{ width: '100%', opacity: count === 0 ? 0.45 : 1 }}>
                  <Box
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      backgroundColor: accent,
                      flexShrink: 0,
                    }}
                  />
                  <Text style={{ flex: 1, fontSize: 13, color: isAll ? SNOW : accent }}>
                    {option.label}
                  </Text>
                  <Text style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 11, color: MIST }}>
                    {count}
                  </Text>
                  {checked && <IconCheck size={13} stroke={2.4} color={CYAN} />}
                </Group>
              );
            }}
            styles={{
              input: {
                height: 38,
                minHeight: 38,
                backgroundColor: '#0B1420',
                borderColor: HAIRLINE,
                color: SNOW,
                fontSize: 13,
              },
              dropdown: { backgroundColor: CARD, borderColor: HAIRLINE },
            }}
          />
          <ActionIcon
            variant="subtle"
            size={38}
            loading={profilesQuery.isFetching}
            onClick={() => qc.invalidateQueries({ queryKey: ['profiles'] })}
            style={{ color: MIST, borderRadius: 8, border: `1px solid ${HAIRLINE}`, backgroundColor: '#0B1420' }}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          <UnstyledButton
            onClick={() => navigate('/profiles/new')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 38,
              padding: '0 16px',
              borderRadius: 8,
              backgroundColor: '#0B1420',
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <IconPlus size={14} stroke={2.4} color={CYAN} />
            <Text style={{ fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 13, fontWeight: 500, color: SNOW }}>
              {t('profiles.create')}
            </Text>
          </UnstyledButton>
        </Box>
      </Box>

      {filtered.length === 0 ? (
        <Card withBorder padding="xl" radius="md" style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
          <Stack align="center" gap="sm">
            <ThemeIcon
              size={48}
              radius="md"
              variant="light"
              style={{ backgroundColor: `${MIST}1A`, color: MIST, border: `1px solid ${MIST}33` }}
            >
              <IconBolt size={24} />
            </ThemeIcon>
            <Text size="sm" style={{ color: MIST }}>
              {profiles.length === 0
                ? t('profiles.emptyAll')
                : t('profiles.emptyFiltered')}
            </Text>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
          {filtered.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              bindingCount={bindingsByProfile.get(p.id) ?? p.bindingCount}
              onEdit={() => navigate(`/profiles/${p.id}`)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </SimpleGrid>
      )}

      <ProfileFormModal
        opened={createOpen}
        onClose={closeCreate}
        profile={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateProfileInput);
          closeCreate();
        }}
      />
      <ProfileFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        profile={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({
            id: editing.id,
            input: input as UpdateProfileInput,
          });
        }}
      />

      <DeployProfileModal
        profile={deploying}
        onClose={() => setDeploying(null)}
      />
      <TestConnectModal
        profile={testing}
        onClose={() => setTesting(null)}
      />
    </Stack>
  );
}

function BarFact({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <>
      <Text style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 13, fontWeight: 500, color: accent ?? SNOW }}>
        {value}
      </Text>
      <Text style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 10, letterSpacing: '0.12em', color: MIST }}>
        {label}
      </Text>
    </>
  );
}

function BarDot() {
  return (
    <Text style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 10, color: '#3A4A60' }}>
      {'·'}
    </Text>
  );
}

/**
 * The three settings that actually distinguish one profile of a protocol from
 * another: the ones an operator would ask about before deploying it. Anything
 * else lives in the editor.
 */
function protocolFacts(profile: Profile): { label: string; value: string }[] {
  const cfg = (profile.config ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = str(cfg[k]);
      if (v) return v;
    }
    return null;
  };

  switch (profile.protocol) {
    case 'xray':
      return [
        { label: 'fingerprint', value: pick('fingerprint', 'fp') ?? '-' },
        { label: 'sni', value: pick('serverName', 'sni', 'dest') ?? '-' },
        { label: 'flow', value: pick('flow') ?? '-' },
      ];
    case 'hysteria':
      return [
        { label: 'alpn', value: pick('alpn') ?? '-' },
        { label: 'obfs', value: pick('obfs', 'obfsType') ?? '-' },
        { label: 'cc', value: pick('congestion', 'cc') ?? '-' },
      ];
    case 'amneziawg':
      return [
        { label: 'mtu', value: pick('mtu') ?? '-' },
        { label: 'subnet', value: pick('subnet', 'address') ?? '-' },
        { label: 'jc', value: pick('jc') ?? '-' },
      ];
    default:
      return [
        { label: 'port', value: pick('port') ?? '-' },
        { label: 'security', value: pick('security', 'securityLayer') ?? '-' },
        { label: 'transport', value: pick('network', 'transport') ?? '-' },
      ];
  }
}

function ProfileCard({
  profile,
  bindingCount,
  onEdit,
  onDelete,
}: {
  profile: Profile;
  bindingCount: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const accent = PROTOCOL_ACCENT[profile.protocol] ?? MIST;
  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={{
        backgroundColor: CARD,
        borderColor: HAIRLINE,
        borderTopWidth: 3,
        borderTopColor: accent,
        opacity: profile.enabled ? 1 : 0.65,
        position: 'relative',
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="md">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
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
            <IconBolt size={18} />
          </ThemeIcon>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate style={{ color: SNOW }}>
              {profile.name}
            </Text>
            {profile.description && (
              <Text size="xs" lineClamp={1} style={{ color: MIST }}>
                {profile.description}
              </Text>
            )}
          </Stack>
        </Group>
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" style={{ color: MIST }}>
              <IconDotsVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          {/* Deploying and test-connect left the profile card: a profile is a
              template, and where it runs is decided on the host, which is the
              thing that actually carries a node and a port. */}
          <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
              {t('common.edit')}
            </Menu.Item>
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
              {t('common.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Group gap="xs" mb="md">
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
          {profile.protocol}
        </Badge>
        <Tooltip label={bindingCount === 0 ? t('profiles.bindingsTooltipNone') : t('profiles.bindingsTooltipDeployed')}>
          <Box
            aria-label={bindingCount === 0 ? t('profiles.bindingsTooltipNone') : t('profiles.bindingsTooltipDeployed')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              backgroundColor: bindingCount === 0 ? 'transparent' : `${MOSS}1A`,
              color: bindingCount === 0 ? MIST : MOSS,
              border: `1px solid ${bindingCount === 0 ? HAIRLINE : `${MOSS}33`}`,
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
            }}
          >
            <IconServer2 size={11} />
            {bindingCount}
          </Box>
        </Tooltip>
        <Tooltip label={t('profiles.usersTooltip', { count: profile.userCount })}>
          <Text
            component="span"
            aria-label={t('profiles.usersTooltip', { count: profile.userCount })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 500,
              backgroundColor: profile.userCount === 0 ? 'transparent' : `${CYAN}1A`,
              color: profile.userCount === 0 ? MIST : CYAN,
              border: `1px solid ${profile.userCount === 0 ? HAIRLINE : `${CYAN}33`}`,
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
            }}
          >
            <IconUsers size={11} />
            {profile.userCount}
          </Text>
        </Tooltip>
        {!profile.enabled && (
          <Badge variant="default" size="sm" style={{ backgroundColor: `${MIST}1A`, color: MIST }}>
            off
          </Badge>

        )}
      </Group>

      {/* The three settings that make this profile this profile. Reading them
          off the card is the difference between "another xray profile" and
          "the one with the firefox fingerprint". */}
      <Box
        style={{
          display: 'flex',
          padding: '10px 12px',
          marginBottom: 14,
          borderRadius: 8,
          backgroundColor: '#0B1420',
        }}
      >
        {protocolFacts(profile).map((f, i) => (
          <Box
            key={f.label}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingLeft: i === 0 ? 0 : 12,
              borderLeft: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
            }}
          >
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 9,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#5A6B82',
              }}
            >
              {f.label}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 12,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {f.value}
            </Text>
          </Box>
        ))}
      </Box>

      {/* One button, no split dropdown: deploy and test already live in the
          card's own menu above, and the same two items in two places is the
          kind of duplication that makes an operator hesitate. */}
      <Group gap={0} wrap="nowrap">
        <UnstyledButton
          onClick={onEdit}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 38,
            borderRadius: 8,
            backgroundColor: `${accent}1A`,
            border: `1px solid ${accent}33`,
          }}
        >
          <IconEdit size={14} stroke={1.8} color={accent} />
          <Text
            style={{
              fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: accent,
            }}
          >
            {t('profiles.configButton', { core: PROTOCOL_LABELS[profile.protocol] ?? profile.protocol })}
          </Text>
        </UnstyledButton>
      </Group>
    </Card>
  );
}

