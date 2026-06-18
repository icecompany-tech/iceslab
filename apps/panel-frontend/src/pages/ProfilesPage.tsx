import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
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
  IconDotsVertical,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconRocket,
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
  type ProtocolName,
  type UpdateProfileInput,
} from '../lib/api';
import { ProfileFormModal } from '../components/ProfileFormModal';
import { DeployProfileModal } from '../components/DeployProfileModal';
import { TestConnectModal } from '../components/TestConnectModal';
import { PageHero } from '../components/PageHero';
import { PrimaryButton } from '../components/PrimaryButton';

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
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
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
      <PageHero
        eyebrow={t('pageHero.profilesEyebrow')}
        title={t('pageHero.profilesTitle')}
        subtitle={t('pageHero.profilesSubtitle')}
        right={
          <Group gap={8}>
            <Tooltip label={t('common.refresh')}>
              <ActionIcon
                variant="subtle"
                size="lg"
                loading={profilesQuery.isFetching}
                onClick={() => qc.invalidateQueries({ queryKey: ['profiles'] })}
                style={{ color: MIST }}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <PrimaryButton leftSection={<IconPlus size={14} />} onClick={openCreate}>
              {t('profiles.create')}
            </PrimaryButton>
          </Group>
        }
      />

      <TextInput
        placeholder={t('profiles.searchPlaceholder')}
        leftSection={<IconSearch size={16} color={MIST} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        styles={{
          input: {
            backgroundColor: CARD,
            borderColor: HAIRLINE,
            color: SNOW,
          },
        }}
      />

      <Group gap="xs" wrap="wrap">
        <ProtocolFilterChip
          label={t('common.all')}
          accent={CYAN}
          active={protocolFilter === 'all'}
          onClick={() => setProtocolFilter('all')}
        />
        {(Object.keys(PROTOCOL_LABELS) as ProtocolName[]).map((p) => (
          <ProtocolFilterChip
            key={p}
            label={PROTOCOL_LABELS[p]}
            accent={PROTOCOL_ACCENT[p] ?? MIST}
            active={protocolFilter === p}
            onClick={() => setProtocolFilter(p)}
          />
        ))}
      </Group>

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
              onEdit={() => setEditing(p)}
              onDelete={() => handleDelete(p)}
              onDeploy={() => setDeploying(p)}
              onTest={() => setTesting(p)}
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

function ProtocolFilterChip({
  label,
  accent,
  active,
  onClick,
}: {
  label: string;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        fontSize: 12,
        // Selected = subtle accent tint + accent border + bright label, NOT a
        // bright accent fill (which "glows" on the dark page and sinks the
        // text). The per-protocol accent stays in the border/tint; inactive
        // chips keep their faint color identity.
        fontWeight: active ? 600 : 500,
        backgroundColor: active ? `${accent}29` : `${accent}14`,
        color: active ? SNOW : accent,
        border: `1px solid ${active ? accent : `${accent}33`}`,
        transition: 'all 120ms',
      }}
    >
      {label}
    </UnstyledButton>
  );
}

function ProfileCard({
  profile,
  bindingCount,
  onEdit,
  onDelete,
  onDeploy,
  onTest,
}: {
  profile: Profile;
  bindingCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onDeploy: () => void;
  onTest: () => void;
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
          <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Menu.Item leftSection={<IconRocket size={14} />} onClick={onDeploy}>
              {t('profiles.deployToNodes')}
            </Menu.Item>
            <Menu.Item leftSection={<IconBolt size={14} />} onClick={onTest}>
              Test connect
            </Menu.Item>
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
            fontFamily: "'Geist Mono', monospace",
            letterSpacing: '0.08em',
          }}
        >
          {profile.protocol}
        </Badge>
        <Tooltip label={bindingCount === 0 ? t('profiles.bindingsTooltipNone') : t('profiles.bindingsTooltipDeployed')}>
          <UnstyledButton
            onClick={onDeploy}
            aria-label={bindingCount === 0 ? t('profiles.bindingsTooltipNone') : t('profiles.bindingsTooltipDeployed')}
            style={{
              cursor: 'pointer',
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
              fontFamily: "'Geist Mono', monospace",
            }}
          >
            <IconServer2 size={11} />
            {bindingCount}
          </UnstyledButton>
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
              fontFamily: "'Geist Mono', monospace",
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

      <Button
        variant="light"
        fullWidth
        leftSection={<IconRocket size={14} />}
        onClick={onDeploy}
        style={{
          backgroundColor: `${accent}1A`,
          color: accent,
          border: `1px solid ${accent}33`,
        }}
      >
        {t('profiles.deployToNodes')}
      </Button>
    </Card>
  );
}

