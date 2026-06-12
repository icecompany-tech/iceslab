import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconEdit,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {
  listCascades,
  createCascade,
  updateCascade,
  deleteCascade,
  listNodes,
  type Cascade,
  type CascadeHopInput,
  type CascadeProtocol,
} from '../lib/api';

const PROTOCOLS: { value: CascadeProtocol; label: string }[] = [
  { value: 'xray', label: 'xray (vless/REALITY)' },
  { value: 'hysteria', label: 'hysteria2' },
  { value: 'shadowsocks', label: 'shadowsocks' },
  { value: 'amneziawg', label: 'amneziawg' },
  { value: 'naive', label: 'naive' },
  { value: 'mtproto', label: 'mtproto' },
  { value: 'mieru', label: 'mieru' },
];

interface HopRow {
  nodeId: string;
  entryProtocol: string;
  linkProtocol: string;
}

export function CascadesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  const nodesQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 200 }) });

  const nodeOptions = useMemo(
    () =>
      (nodesQuery.data?.nodes ?? []).map((n) => ({ value: n.id, label: `${n.name} (${n.protocol})` })),
    [nodesQuery.data],
  );

  const [editing, setEditing] = useState<Cascade | 'new' | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cascades'] });
  const onError = (err: unknown) =>
    notifications.show({
      color: 'red',
      title: t('common.saveError'),
      message: err instanceof Error ? err.message : String(err),
    });

  const deleteMutation = useMutation({
    mutationFn: deleteCascade,
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('cascades.deleted') });
    },
    onError,
  });

  const cascades = cascadesQuery.data?.cascades ?? [];

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between">
        <Text fw={600} size="lg">
          {t('cascades.title')}
        </Text>
        <Button leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
          {t('cascades.add')}
        </Button>
      </Group>
      <Text size="xs" c="dimmed" maw={760}>
        {t('cascades.help')}
      </Text>

      {cascades.length === 0 && cascadesQuery.isFetched && (
        <Text size="sm" c="dimmed">
          {t('cascades.empty')}
        </Text>
      )}

      {cascades.map((c) => (
        <Card key={c.id} withBorder padding="sm" radius="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs">
              <Text fw={500}>{c.name}</Text>
              <Badge size="sm" color={c.enabled ? 'teal' : 'gray'} variant="light">
                {c.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Group gap={4} wrap="nowrap">
              <Tooltip label={t('common.edit')}>
                <ActionIcon variant="subtle" color="blue" onClick={() => setEditing(c)}>
                  <IconEdit size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('common.delete')}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  loading={deleteMutation.isPending && deleteMutation.variables === c.id}
                  onClick={() => deleteMutation.mutate(c.id)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Group gap={6} mt="xs" wrap="wrap">
            {c.hops.map((h, i) => {
              const role =
                i === 0 ? t('cascades.entry') : i === c.hops.length - 1 ? t('cascades.exit') : t('cascades.transit');
              const color = i === 0 ? 'blue' : i === c.hops.length - 1 ? 'green' : 'gray';
              return (
                <Group key={h.id} gap={6} wrap="nowrap">
                  <Badge variant="light" color={color} radius="sm">
                    {role}: {h.nodeName}
                    {h.entryProtocol ? ` · ${h.entryProtocol}` : ''}
                  </Badge>
                  {i < c.hops.length - 1 && (
                    <Group gap={2} wrap="nowrap" c="dimmed">
                      <Text size="9px" ff="monospace">
                        {h.linkProtocol}
                      </Text>
                      <IconArrowRight size={12} />
                    </Group>
                  )}
                </Group>
              );
            })}
          </Group>
        </Card>
      ))}

      <CascadeFormModal
        opened={editing !== null}
        cascade={editing === 'new' ? null : editing}
        nodeOptions={nodeOptions}
        onClose={() => setEditing(null)}
        onSaved={() => {
          invalidate();
          setEditing(null);
        }}
        onError={onError}
      />
    </Stack>
  );
}

function CascadeFormModal({
  opened,
  cascade,
  nodeOptions,
  onClose,
  onSaved,
  onError,
}: {
  opened: boolean;
  cascade: Cascade | null;
  nodeOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hops, setHops] = useState<HopRow[]>([]);
  const [lastFor, setLastFor] = useState<string | null | undefined>(undefined);

  // Seed the form when the modal opens for a (different) cascade.
  if (opened && lastFor !== (cascade?.id ?? null)) {
    setLastFor(cascade?.id ?? null);
    if (cascade) {
      setName(cascade.name);
      setEnabled(cascade.enabled);
      setHops(
        cascade.hops.map((h) => ({
          nodeId: h.nodeId,
          entryProtocol: h.entryProtocol ?? '',
          linkProtocol: h.linkProtocol ?? '',
        })),
      );
    } else {
      setName('');
      setEnabled(true);
      setHops([
        { nodeId: '', entryProtocol: 'xray', linkProtocol: 'xray' },
        { nodeId: '', entryProtocol: '', linkProtocol: '' },
      ]);
    }
  } else if (!opened && lastFor !== undefined) {
    setLastFor(undefined);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const hopInputs: CascadeHopInput[] = hops.map((h, i) => ({
        nodeId: h.nodeId,
        position: i,
        ...(i === 0 && h.entryProtocol ? { entryProtocol: h.entryProtocol as CascadeProtocol } : {}),
        ...(i < hops.length - 1 && h.linkProtocol ? { linkProtocol: h.linkProtocol as CascadeProtocol } : {}),
      }));
      return cascade
        ? updateCascade(cascade.id, { name, enabled, hops: hopInputs })
        : createCascade({ name, enabled, hops: hopInputs });
    },
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('cascades.saved') });
      onSaved();
    },
    onError,
  });

  function setHop(idx: number, patch: Partial<HopRow>) {
    setHops((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }
  function addHop() {
    setHops((prev) => [...prev, { nodeId: '', entryProtocol: '', linkProtocol: 'xray' }]);
  }
  function removeHop(idx: number) {
    setHops((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= hops.length) return;
    setHops((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  }

  const valid = name.trim().length > 0 && hops.length >= 2 && hops.every((h) => h.nodeId);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={cascade ? t('cascades.editTitle', { name: cascade.name }) : t('cascades.newTitle')}
    >
      <Stack gap="sm">
        <TextInput
          label={t('cascades.name')}
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Switch
          label={t('cascades.enabledLabel')}
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />

        <Text size="sm" fw={500} mt="xs">
          {t('cascades.hops')}
        </Text>
        <Stack gap={6}>
          {hops.map((h, i) => {
            const isEntry = i === 0;
            const isExit = i === hops.length - 1;
            const role = isEntry ? t('cascades.entry') : isExit ? t('cascades.exit') : t('cascades.transit');
            return (
              <Card key={i} withBorder padding="xs" radius="sm">
                <Group gap="xs" align="flex-end" wrap="nowrap">
                  <Badge
                    size="sm"
                    color={isEntry ? 'blue' : isExit ? 'green' : 'gray'}
                    variant="light"
                    style={{ minWidth: 64 }}
                  >
                    {role}
                  </Badge>
                  <Select
                    label={t('cascades.node')}
                    placeholder="-"
                    data={nodeOptions}
                    searchable
                    value={h.nodeId || null}
                    onChange={(v) => setHop(i, { nodeId: v ?? '' })}
                    style={{ flex: 1 }}
                  />
                  {isEntry && (
                    <Select
                      label={t('cascades.entryProtocol')}
                      data={PROTOCOLS}
                      value={h.entryProtocol || null}
                      onChange={(v) => setHop(i, { entryProtocol: v ?? '' })}
                      w={150}
                    />
                  )}
                  {!isExit && (
                    <Select
                      label={t('cascades.linkProtocol')}
                      data={PROTOCOLS}
                      value={h.linkProtocol || null}
                      onChange={(v) => setHop(i, { linkProtocol: v ?? '' })}
                      w={150}
                    />
                  )}
                  <Box>
                    <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)}>
                      <IconArrowUp size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      disabled={i === hops.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <IconArrowDown size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      disabled={hops.length <= 2}
                      onClick={() => removeHop(i)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Box>
                </Group>
              </Card>
            );
          })}
        </Stack>
        <Button variant="light" size="xs" leftSection={<IconPlus size={12} />} onClick={addHop}>
          {t('cascades.addHop')}
        </Button>

        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {cascade ? t('common.save') : t('common.create')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
