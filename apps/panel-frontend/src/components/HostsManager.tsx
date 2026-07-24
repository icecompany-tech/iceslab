import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowDown,
  IconArrowUp,
  IconEdit,
  IconPlus,
  IconTrash,
  IconWorldShare,
} from '@tabler/icons-react';
import {
  createHost,
  deleteHost,
  reorderHosts,
  updateHost,
  type CreateHostInput,
  type Fingerprint,
  type Host,
  type ProtocolName,
  type UpdateHostInput,
} from '../lib/api';

// AmneziaWG can't multi-host meaningfully - pubkey-pinned UDP single endpoint.
// Hide the manager entirely for that protocol.
const PROTOCOLS_WITHOUT_HOSTS: ReadonlySet<ProtocolName> = new Set(['amneziawg']);

const FINGERPRINT_OPTIONS: { value: Fingerprint; label: string }[] = [
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'safari', label: 'Safari' },
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'edge', label: 'Edge' },
  { value: 'random', label: 'Random' },
];

const FORMAT_OPTIONS = [
  { value: 'plain', label: 'plain (base64)' },
  { value: 'clash', label: 'Clash YAML' },
  { value: 'singbox', label: 'Sing-box JSON' },
  { value: 'xrayjson', label: 'Xray JSON' },
  { value: 'xrayjson-array', label: 'Xray JSON array' },
  { value: 'xkeen', label: 'XKeen (router)' },
  { value: 'outline', label: 'Outline (SIP008)' },
  { value: 'surge', label: 'Surge' },
  { value: 'quantumultx', label: 'Quantumult X' },
  { value: 'loon', label: 'Loon' },
  { value: 'wgconf', label: 'wg-quick' },
  { value: 'mieru-json', label: 'Mieru JSON' },
];

interface HostsManagerProps {
  bindingId: string;
  protocol: ProtocolName;
  // F7 - hosts are fetched ONCE at the node level by NodeEditModal and passed
  // down pre-filtered per binding, so this component no longer mounts its own
  // ['hosts', bindingId] query (a node with N bindings used to fire N requests).
  hosts: Host[];
  nodeId: string;
  loading?: boolean;
}

/**
 * Inline manager for the hosts attached to a single binding. Slice 30
 * surface - list / add / edit / delete / reorder. Drag-and-drop is
 * deferred (slice 31), arrows are plenty for typical 2-4 host setups.
 */
export function HostsManager({
  bindingId,
  protocol,
  hosts: hostsProp,
  nodeId,
  loading,
}: HostsManagerProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);

  const supportsHosts = !PROTOCOLS_WITHOUT_HOSTS.has(protocol);

  const hosts = useMemo(
    () => [...hostsProp].sort((a, b) => a.priority - b.priority),
    [hostsProp],
  );

  // F7 - mutations refetch the node-level query the parent owns, not a
  // per-binding one.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hosts', 'node', nodeId] });
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateHostInput) => createHost(input),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('hosts.notify.created') });
      setAddOpen(false);
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHostInput }) =>
      updateHost(id, input),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('hosts.notify.updated') });
      setEditing(null);
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHost(id),
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('hosts.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderHosts(ids),
    onSuccess: () => invalidate(),
    // F6 - a failed reorder used to fail silently (no onError handler): the
    // arrow move looked like it worked but the server order never changed.
    // Surface the error and resync the list from the server.
    onError: (err) => {
      invalidate();
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  function move(idx: number, dir: -1 | 1) {
    const next = [...hosts];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    reorderMutation.mutate(next.map((h) => h.id));
  }

  if (!supportsHosts) {
    return (
      <Text size="xs" c="dimmed" py="xs">
        {t('hosts.awgUnsupported')}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap={6}>
          <IconWorldShare size={14} />
          <Text size="sm" fw={500}>
            {t('hosts.sectionLabel', { count: hosts.length })}
          </Text>
        </Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={12} />}
          onClick={() => setAddOpen(true)}
        >
          {t('hosts.addButton')}
        </Button>
      </Group>

      {!loading && hosts.length === 0 && (
        <Text size="xs" c="dimmed" py="xs">
          {t('hosts.empty')}
        </Text>
      )}

      <Stack gap={4}>
        {hosts.map((h, idx) => (
          <HostRow
            key={h.id}
            host={h}
            onUp={idx > 0 ? () => move(idx, -1) : undefined}
            onDown={idx < hosts.length - 1 ? () => move(idx, 1) : undefined}
            onToggle={(enabled) =>
              updateMutation.mutate({ id: h.id, input: { enabled } })
            }
            onEdit={() => setEditing(h)}
            onDelete={() => deleteMutation.mutate(h.id)}
          />
        ))}
      </Stack>

      <HostFormModal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        protocol={protocol}
        host={null}
        loading={createMutation.isPending}
        onSubmit={(input) =>
          createMutation.mutate({ ...input, bindingId })
        }
      />
      <HostFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        protocol={protocol}
        host={editing}
        loading={updateMutation.isPending}
        onSubmit={(input) => {
          if (!editing) return;
          updateMutation.mutate({ id: editing.id, input });
        }}
      />
    </Stack>
  );
}

function HostRow({
  host,
  onUp,
  onDown,
  onToggle,
  onEdit,
  onDelete,
}: {
  host: Host;
  onUp?: () => void;
  onDown?: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const overrideBadges: { label: string; color: string }[] = [];
  if (host.sniOverride) overrideBadges.push({ label: `sni=${host.sniOverride}`, color: 'blue' });
  if (host.fingerprintOverride) overrideBadges.push({ label: `fp=${host.fingerprintOverride}`, color: 'grape' });
  if (host.pathOverride) overrideBadges.push({ label: `path=${host.pathOverride}`, color: 'teal' });
  if (host.addressOverride) overrideBadges.push({ label: `host=${host.addressOverride}`, color: 'orange' });
  if (host.alpn.length > 0) overrideBadges.push({ label: `alpn=${host.alpn.join(',')}`, color: 'cyan' });
  if (host.securityLayer !== 'default') overrideBadges.push({ label: `sec=${host.securityLayer}`, color: 'red' });
  if (host.allowInsecure) overrideBadges.push({ label: 'insecure', color: 'red' });

  return (
    <Paper
      withBorder
      p="xs"
      radius="sm"
      style={{
        borderLeft: `3px solid var(--mantine-color-${host.enabled ? 'teal' : 'gray'}-6)`,
        opacity: host.enabled ? 1 : 0.55,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="wrap">
            <Text size="sm" fw={500} truncate>
              {host.remark}
            </Text>
            {overrideBadges.length === 0 && (
              <Badge size="xs" variant="light" color="gray">
                no overrides
              </Badge>
            )}
            {overrideBadges.map((b) => (
              <Badge key={b.label} size="xs" variant="light" color={b.color}>
                {b.label}
              </Badge>
            ))}
          </Group>
          {host.disableForFormats.length > 0 && (
            <Group gap={4}>
              <Text size="xs" c="dimmed">
                disabled in:
              </Text>
              {host.disableForFormats.map((f) => (
                <Badge key={f} size="xs" variant="outline" color="red">
                  {f}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={t('hostsManager.enabledInSubscription')}>
            <Switch
              size="xs"
              checked={host.enabled}
              onChange={(e) => onToggle(e.currentTarget.checked)}
            />
          </Tooltip>
          <Tooltip label={t('hostsManager.moveUp')}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              disabled={!onUp}
              onClick={onUp}
            >
              <IconArrowUp size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('hostsManager.moveDown')}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              disabled={!onDown}
              onClick={onDown}
            >
              <IconArrowDown size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('hostsManager.edit')}>
            <ActionIcon
              variant="subtle"
              color="blue"
              size="sm"
              onClick={onEdit}
            >
              <IconEdit size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('hostsManager.remove')}>
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              onClick={onDelete}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}

interface HostFormValues {
  remark: string;
  enabled: boolean;
  addressOverride: string;
  portOverride: number | '';
  sniOverride: string;
  hostHeaderOverride: string;
  pathOverride: string;
  fingerprintOverride: Fingerprint | '';
  alpn: string[];
  allowInsecure: boolean;
  securityLayer: 'default' | 'tls' | 'none';
  disableForFormats: string[];
}

function emptyValues(): HostFormValues {
  return {
    remark: '',
    enabled: true,
    addressOverride: '',
    portOverride: '',
    sniOverride: '',
    hostHeaderOverride: '',
    pathOverride: '',
    fingerprintOverride: '',
    alpn: [],
    allowInsecure: false,
    securityLayer: 'default',
    disableForFormats: [],
  };
}

function HostFormModal({
  opened,
  onClose,
  protocol,
  host,
  loading,
  onSubmit,
}: {
  opened: boolean;
  onClose: () => void;
  protocol: ProtocolName;
  host: Host | null;
  loading: boolean;
  onSubmit: (input: CreateHostInput) => void;
}) {
  const { t } = useTranslation();
  const isXray = protocol === 'xray';
  const supportsPath = isXray;

  const form = useForm<HostFormValues>({
    initialValues: emptyValues(),
    validate: {
      remark: (v) => (v.trim().length === 0 ? t('hostsManager.remarkRequired') : null),
    },
  });

  // Reset when modal opens with a different host (or null for create).
  // useForm has stale state across opens otherwise.
  function syncFromHost() {
    if (!host) {
      form.setValues(emptyValues());
      return;
    }
    form.setValues({
      remark: host.remark,
      enabled: host.enabled,
      addressOverride: host.addressOverride ?? '',
      portOverride: host.portOverride ?? '',
      sniOverride: host.sniOverride ?? '',
      hostHeaderOverride: host.hostHeaderOverride ?? '',
      pathOverride: host.pathOverride ?? '',
      fingerprintOverride: host.fingerprintOverride ?? '',
      alpn: host.alpn,
      allowInsecure: host.allowInsecure,
      securityLayer: host.securityLayer,
      disableForFormats: host.disableForFormats,
    });
  }

  // Effect-free sync - Mantine modal calls `onClose` then re-mounts on
  // re-open via key change isn't reliable here, so we sync on first render
  // when `opened` flips. Cheap because it only sets state.
  const [lastOpenedFor, setLastOpenedFor] = useState<string | null | undefined>(undefined);
  if (opened && lastOpenedFor !== (host?.id ?? null)) {
    setLastOpenedFor(host?.id ?? null);
    syncFromHost();
  } else if (!opened && lastOpenedFor !== undefined) {
    setLastOpenedFor(undefined);
  }

  function handleSubmit(values: HostFormValues) {
    const input: CreateHostInput = {
      bindingId: host?.bindingId ?? '',
      remark: values.remark.trim(),
      enabled: values.enabled,
      addressOverride: values.addressOverride.trim() || null,
      portOverride: values.portOverride === '' ? null : values.portOverride,
      sniOverride: values.sniOverride.trim() || null,
      hostHeaderOverride: values.hostHeaderOverride.trim() || null,
      pathOverride: values.pathOverride.trim() || null,
      fingerprintOverride:
        values.fingerprintOverride === '' ? null : values.fingerprintOverride,
      alpn: values.alpn,
      allowInsecure: values.allowInsecure,
      securityLayer: values.securityLayer,
      disableForFormats: values.disableForFormats,
    };
    onSubmit(input);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={host ? t('hostsManager.titleEdit', { name: host.remark }) : t('hostsManager.titleNew')}
      size="lg"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="sm">
          <TextInput
            label="Remark"
            description={t('hostsManager.remarkDesc')}
            required
            {...form.getInputProps('remark')}
          />
          <Switch
            label={t('hostsManager.enabledInSubscription')}
            {...form.getInputProps('enabled', { type: 'checkbox' })}
          />

          <Group grow>
            <TextInput
              label="Address override"
              placeholder="cdn.example.com - оставь пустым чтобы использовать node.address"
              {...form.getInputProps('addressOverride')}
            />
            <NumberInput
              label="Port override"
              placeholder={t('hostsManager.portPlaceholder')}
              min={1}
              max={65535}
              {...form.getInputProps('portOverride')}
            />
          </Group>

          {isXray && (
            <>
              <Group grow>
                <TextInput
                  label="SNI override"
                  placeholder={t('hostsManager.sniPlaceholder')}
                  {...form.getInputProps('sniOverride')}
                />
                <Select
                  label="Fingerprint"
                  data={[{ value: '', label: '- по умолчанию -' }, ...FINGERPRINT_OPTIONS]}
                  {...form.getInputProps('fingerprintOverride')}
                />
              </Group>
              {supportsPath && (
                <Group grow>
                  <TextInput
                    label="Path override"
                    placeholder="/path для ws/xhttp"
                    {...form.getInputProps('pathOverride')}
                  />
                  <TextInput
                    label="Host header"
                    placeholder="cdn.example.com"
                    {...form.getInputProps('hostHeaderOverride')}
                  />
                </Group>
              )}
              <MultiSelect
                label="ALPN"
                description="emit в URI формат когда доступен (slice 30.1)"
                data={['h2', 'http/1.1', 'h3']}
                searchable
                clearable
                {...form.getInputProps('alpn')}
              />
            </>
          )}

          <Group grow>
            <Select
              label="Security layer"
              description="default = REALITY/TLS адаптера; tls = поверх TLS на CDN"
              data={[
                { value: 'default', label: 'default (адаптер сам решает)' },
                { value: 'tls', label: 'tls (CDN-front)' },
                { value: 'none', label: 'none (plain)' },
              ]}
              {...form.getInputProps('securityLayer')}
            />
            <Switch
              label="Allow insecure cert"
              description="?allowInsecure=1"
              mt="lg"
              {...form.getInputProps('allowInsecure', { type: 'checkbox' })}
            />
          </Group>

          <MultiSelect
            label={t('hostsManager.disableForFormatsLabel')}
            description="host пропускается при выдаче этих форматов подписки"
            data={FORMAT_OPTIONS}
            searchable
            clearable
            {...form.getInputProps('disableForFormats')}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={loading}>
              {host ? t('hostsManager.submitSave') : t('hostsManager.submitCreate')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

