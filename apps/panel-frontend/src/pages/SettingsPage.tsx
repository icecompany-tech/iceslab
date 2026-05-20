import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { PageHero } from '../components/PageHero';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCheck,
  IconCopy,
  IconKey,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconWorld,
  IconTrash,
} from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';
import {
  createApiToken,
  createRegion,
  deleteApiToken,
  deleteRegion,
  listApiTokens,
  listRegions,
  getSettings,
  updateRegion,
  updateSettings,
  type ApiToken,
  type Region,
} from '../lib/api';

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      <PageHero
        eyebrow={t('pageHero.settingsEyebrow')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      <CustomizationCard />
      <ApiTokensCard />
      <RegionsCard />
    </Stack>
  );
}

// ───── API tokens ─────

function ApiTokensCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const tokensQuery = useQuery({
    queryKey: ['api-tokens'],
    queryFn: listApiTokens,
  });

  const createMutation = useMutation({
    mutationFn: createApiToken,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      setRevealed(created.token);
      closeCreate();
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteApiToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      notifications.show({ color: 'green', message: t('settings.tokens.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(token: ApiToken) {
    modals.openConfirmModal({
      title: t('settings.tokens.deleteTitle', { name: token.name }),
      children: (
        <Text size="sm">
          {t('settings.tokens.deleteBody')}
        </Text>
      ),
      labels: { confirm: t('settings.tokens.revoke'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(token.id),
    });
  }

  const tokens = tokensQuery.data?.tokens ?? [];

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Group gap="sm">
          <ThemeIcon size={32} radius="md" variant="light" color="violet">
            <IconKey size={18} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={600}>{t('settings.tokens.title')}</Text>
            <Text size="xs" c="dimmed">
              {t('settings.tokens.description')}
            </Text>
          </Stack>
        </Group>
        <Tooltip label={t('common.refresh')}>
          <ActionIcon
            variant="subtle"
            size="sm"
            loading={tokensQuery.isFetching}
            onClick={() => qc.invalidateQueries({ queryKey: ['api-tokens'] })}
          >
            <IconRefresh size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {tokens.length === 0 ? (
        <Text c="dimmed" size="sm" py="md" ta="center">
          {t('settings.tokens.empty')}
        </Text>
      ) : (
        <Stack gap="xs">
          {tokens.map((tok) => (
            <Paper key={tok.id} withBorder p="sm" radius="sm">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                  <Text size="sm" fw={500}>
                    {tok.name}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {t('settings.tokens.tableCreated')} {new Date(tok.createdAt).toLocaleString()}
                    {tok.lastUsedAt
                      ? ` · ${t('settings.tokens.tableLastUsed')} ${new Date(tok.lastUsedAt).toLocaleString()}`
                      : ''}
                  </Text>
                </Stack>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label={t('settings.tokens.copyId')}>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={async () => {
                        await copyToClipboard(tok.id);
                        notifications.show({
                          color: 'teal',
                          message: t('settings.tokens.idCopied'),
                          autoClose: 1500,
                        });
                      }}
                    >
                      <IconCopy size={14} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('settings.tokens.revoke')}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() => handleDelete(tok)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      <Button
        mt="md"
        variant="light"
        leftSection={<IconPlus size={14} />}
        onClick={openCreate}
        fullWidth
      >
        {t('settings.tokens.createButton')}
      </Button>

      <CreateApiTokenModal
        opened={createOpen}
        onClose={closeCreate}
        loading={createMutation.isPending}
        onSubmit={(name) => createMutation.mutate({ name })}
      />

      <RevealTokenModal
        token={revealed}
        onClose={() => setRevealed(null)}
      />
    </Card>
  );
}

function CreateApiTokenModal({
  opened,
  onClose,
  onSubmit,
  loading,
}: {
  opened: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title={t('settings.tokens.modalTitle')} size="md">
      <Stack>
        <TextInput
          label={t('settings.tokens.modalName')}
          placeholder={t('settings.tokens.modalNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          autoFocus
        />
        <Alert color="yellow" variant="light">
          {t('settings.tokens.modalWarning')}
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              if (name.trim().length === 0) return;
              onSubmit(name.trim());
              setName('');
            }}
            loading={loading}
            disabled={name.trim().length === 0}
          >
            {t('settings.tokens.modalSubmit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RevealTokenModal({
  token,
  onClose,
}: {
  token: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!token) return;
    await copyToClipboard(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal
      opened={token !== null}
      onClose={onClose}
      title={t('settings.tokens.revealTitle')}
      size="md"
      withCloseButton
    >
      <Stack>
        <Alert color="yellow" variant="light">
          {t('settings.tokens.revealHint')}
        </Alert>
        <Code
          block
          style={{
            fontSize: 12,
            wordBreak: 'break-all',
            cursor: 'pointer',
          }}
          onClick={copy}
        >
          {token}
        </Code>
        <Group justify="flex-end">
          <Button
            variant="light"
            leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            onClick={copy}
            color={copied ? 'teal' : undefined}
          >
            {copied ? t('settings.tokens.revealCopied') : t('settings.tokens.revealCopy')}
          </Button>
          <Button onClick={onClose}>{t('settings.tokens.revealDone')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ───── Customization ─────

function CustomizationCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: getSettings,
  });
  const [brandName, setBrandName] = useState('');

  // Hydrate local edit state once when the server value lands.
  useEffect(() => {
    if (settingsQuery.data?.brandName && brandName === '') {
      setBrandName(settingsQuery.data.brandName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: { brandName: string }) => updateSettings(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({
        color: 'green',
        message: t('settingsNotify.savedOk'),
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('settingsNotify.saveErrorTitle'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function save() {
    const trimmed = brandName.trim() || 'Iceslab';
    saveMutation.mutate({ brandName: trimmed });
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon size={32} radius="md" variant="light" color="grape">
          <IconPalette size={18} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600}>{t('settings.customization.title')}</Text>
          <Text size="xs" c="dimmed">
            {t('settings.customization.description')}
          </Text>
        </Stack>
      </Group>

      <Stack gap="sm" maw={500}>
        <TextInput
          label={t('settings.customization.brandName')}
          description={t('settings.customization.brandNameDesc')}
          value={brandName}
          onChange={(e) => setBrandName(e.currentTarget.value)}
          placeholder="Iceslab"
        />
        <Group justify="flex-end">
          <Button
            onClick={save}
            loading={saveMutation.isPending}
            disabled={settingsQuery.isLoading}
            leftSection={<IconCheck size={14} />}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// ───── Regions (slice 27.5) ─────

/**
 * Plain CRUD for `regions` - admins create/rename/delete logical groups
 * ("EU", "RU", "Asia") and then attach nodes to them via NodeFormModal.
 * Slice 28 will read region.code against GeoIP at /sub/:token; here we
 * just give admins the chair to maintain the table.
 */
function RegionsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const regionsQuery = useQuery({ queryKey: ['regions'], queryFn: listRegions });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<Region | null>(null);

  const createMutation = useMutation({
    mutationFn: createRegion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      setName('');
      setCode('');
      notifications.show({ color: 'green', message: t('regions.notify.created') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; code?: string } }) =>
      updateRegion(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      setEditing(null);
      notifications.show({ color: 'green', message: t('regions.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRegion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: t('regions.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(r: Region) {
    modals.openConfirmModal({
      title: t('regions.deleteTitle', { name: r.name }),
      children: (
        <Text size="sm">
          {r.nodeCount && r.nodeCount > 0
            ? t('regions.deleteWithNodes', { count: r.nodeCount })
            : t('regions.deleteSafe')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(r.id),
    });
  }

  const regions = regionsQuery.data?.regions ?? [];

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon size={32} radius="md" variant="light" color="cyan">
          <IconWorld size={18} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600}>{t('regions.title')}</Text>
          <Text size="xs" c="dimmed">
            {t('regions.description')}
          </Text>
        </Stack>
      </Group>

      <Stack gap="sm" maw={620}>
        {regions.length === 0 ? (
          <Text size="xs" c="dimmed">
            {t('regions.empty')}
          </Text>
        ) : (
          <Stack gap={4}>
            {regions.map((r) =>
              editing?.id === r.id ? (
                <RegionEditRow
                  key={r.id}
                  region={r}
                  loading={updateMutation.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(input) =>
                    updateMutation.mutate({ id: r.id, input })
                  }
                />
              ) : (
                <Paper key={r.id} withBorder p="xs" radius="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <Badge variant="light" color="cyan" size="lg">
                        {r.code}
                      </Badge>
                      <Stack gap={0}>
                        <Text size="sm" fw={500}>
                          {r.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t('regions.nodesCount', { count: r.nodeCount ?? 0 })}
                        </Text>
                      </Stack>
                    </Group>
                    <Group gap={4}>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => setEditing(r)}
                      >
                        <IconRefresh size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() => handleDelete(r)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </Paper>
              ),
            )}
          </Stack>
        )}

        <Group gap="sm" align="flex-end">
          <TextInput
            label={t('regions.name')}
            placeholder={t('regions.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            style={{ flex: 2 }}
          />
          <TextInput
            label={t('regions.code')}
            placeholder={t('regions.codePlaceholder')}
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
            style={{ flex: 1 }}
            maxLength={16}
          />
          <Button
            leftSection={<IconPlus size={14} />}
            disabled={!name.trim() || !code.trim()}
            loading={createMutation.isPending}
            onClick={() =>
              createMutation.mutate({ name: name.trim(), code: code.trim() })
            }
          >
            {t('regions.add')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function RegionEditRow({
  region,
  loading,
  onSave,
  onCancel,
}: {
  region: Region;
  loading: boolean;
  onSave: (input: { name: string; code: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(region.name);
  const [code, setCode] = useState(region.code);
  return (
    <Paper withBorder p="xs" radius="sm">
      <Group gap="xs" align="flex-end">
        <TextInput
          label={t('regions.name')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          style={{ flex: 2 }}
        />
        <TextInput
          label={t('regions.code')}
          value={code}
          onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
          style={{ flex: 1 }}
          maxLength={16}
        />
        <Button
          size="sm"
          loading={loading}
          onClick={() => onSave({ name: name.trim(), code: code.trim() })}
        >
          OK
        </Button>
        <Button size="sm" variant="subtle" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </Group>
    </Paper>
  );
}

