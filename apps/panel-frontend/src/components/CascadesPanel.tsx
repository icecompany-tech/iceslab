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
  IconRoute,
  IconTrash,
} from '@tabler/icons-react';
import {
  listCascades,
  createCascade,
  updateCascade,
  deleteCascade,
  listNodes,
  apiErrorMessage,
  type Cascade,
  type CascadeHopInput,
  type CascadeProtocol,
} from '../lib/api';
import { useOverview } from '../hooks/useOverview';
import { countryFlag } from '../lib/countries';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const GROUND = '#0B1521';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';
const MONO = { fontFamily: "'Geist Mono', monospace" } as const;

const STATUS_ACCENT: Record<string, string> = {
  online: MOSS,
  unknown: MIST,
  offline: RED,
  unreachable: RED,
  disabled: MIST,
  degraded: AMBER,
};

const PROTOCOLS: { value: CascadeProtocol; label: string }[] = [
  { value: 'xray', label: 'xray' },
  { value: 'hysteria', label: 'hysteria2' },
  { value: 'shadowsocks', label: 'shadowsocks' },
  { value: 'amneziawg', label: 'amneziawg' },
  { value: 'naive', label: 'naive' },
  { value: 'mtproto', label: 'mtproto' },
  { value: 'mieru', label: 'mieru' },
];

// Max hops per cascade. Mirrors the backend cap (cascade.schemas MAX_CASCADE_HOPS);
// keep the two in sync. Each hop adds latency + an inter-hop UFW link port.
const MAX_HOPS = 5;

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

interface ChainNode {
  name: string;
  countryCode: string | null;
  status: string;
  todayBytes: number | null;
}

/**
 * The "Cascades" sub-view of the Nodes page. A cascade is a chain of nodes, so
 * each hop is drawn as a real node card (flag / status / role / today's
 * traffic), connected entry -> ... -> exit by arrows labelled with the link
 * protocol. Self-contained: pulls its own cascades + node list + overview
 * metrics (react-query dedupes the shared keys with NodesPage).
 */
export function CascadesPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  const nodesQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 200 }) });
  const overviewQuery = useOverview();

  const nodeOptions = useMemo(
    () =>
      (nodesQuery.data?.nodes ?? []).map((n) => ({ value: n.id, label: `${n.name} (${n.protocol})` })),
    [nodesQuery.data],
  );

  // nodeId -> chain render data (status/flag/traffic) for the hop cards.
  const nodesById = useMemo(() => {
    const overviewById = new Map((overviewQuery.data?.nodes ?? []).map((n) => [n.id, n]));
    const m = new Map<string, ChainNode>();
    for (const n of nodesQuery.data?.nodes ?? []) {
      const ov = overviewById.get(n.id);
      m.set(n.id, {
        name: n.name,
        countryCode: n.countryCode,
        status: ov?.status ?? n.status,
        todayBytes: ov?.todayBytes ?? null,
      });
    }
    return m;
  }, [nodesQuery.data, overviewQuery.data]);

  const [editing, setEditing] = useState<Cascade | 'new' | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cascades'] });
  const onError = (err: unknown) =>
    notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) });

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
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Text size="xs" c="dimmed" maw={760}>
          {t('cascades.help')}
        </Text>
        <Button leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
          {t('cascades.add')}
        </Button>
      </Group>

      {cascades.length === 0 && cascadesQuery.isFetched && (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          {t('cascades.empty')}
        </Text>
      )}

      {cascades.map((c) => (
        <Card
          key={c.id}
          withBorder
          padding="md"
          radius="md"
          style={{ backgroundColor: CARD, borderColor: HAIRLINE }}
        >
          <Group justify="space-between" wrap="nowrap" mb="sm">
            <Group gap="xs">
              <IconRoute size={16} style={{ color: VIOLET }} />
              <Text fw={600} style={{ color: SNOW }}>
                {c.name}
              </Text>
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

          <Group gap="sm" wrap="wrap" align="stretch">
            {c.hops.map((h, i) => {
              const role =
                i === 0
                  ? t('cascades.entry')
                  : i === c.hops.length - 1
                    ? t('cascades.exit')
                    : t('cascades.transit');
              const roleColor = i === 0 ? CYAN : i === c.hops.length - 1 ? MOSS : MIST;
              const nd = nodesById.get(h.nodeId);
              const status = nd?.status ?? 'unknown';
              const accent = STATUS_ACCENT[status] ?? MIST;
              return (
                <Group key={h.id} gap="sm" wrap="nowrap" align="center">
                  <Box
                    style={{
                      border: `1px solid ${roleColor}44`,
                      borderRadius: 8,
                      background: GROUND,
                      padding: '8px 10px',
                      minWidth: 150,
                    }}
                  >
                    <Group gap={6} wrap="nowrap" mb={4}>
                      {nd?.countryCode && (
                        <Text size="sm" lh={1}>
                          {countryFlag(nd.countryCode)}
                        </Text>
                      )}
                      <Text fw={600} size="sm" truncate style={{ color: SNOW, maxWidth: 120 }}>
                        {nd?.name ?? h.nodeName}
                      </Text>
                    </Group>
                    <Group gap={6} wrap="nowrap" mb={4}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: accent,
                          boxShadow: `0 0 6px ${accent}99`,
                          flexShrink: 0,
                        }}
                      />
                      <Text size="xs" style={{ ...MONO, color: accent, textTransform: 'uppercase' }}>
                        {status}
                      </Text>
                    </Group>
                    <Badge
                      size="xs"
                      variant="light"
                      style={{
                        backgroundColor: `${roleColor}1A`,
                        color: roleColor,
                        border: `1px solid ${roleColor}33`,
                        textTransform: 'none',
                      }}
                    >
                      {role}
                      {h.entryProtocol ? ` · ${h.entryProtocol}` : ''}
                    </Badge>
                    {nd?.todayBytes != null && (
                      <Text size="9px" mt={4} style={{ ...MONO, color: MIST }}>
                        {formatBytes(nd.todayBytes)} {t('cascades.today')}
                      </Text>
                    )}
                  </Box>
                  {i < c.hops.length - 1 && (
                    <Stack gap={0} align="center" justify="center" style={{ color: MIST }}>
                      <Text size="9px" ff="monospace">
                        {h.linkProtocol}
                      </Text>
                      <IconArrowRight size={16} />
                    </Stack>
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

interface HopRow {
  nodeId: string;
  entryProtocol: string;
  linkProtocol: string;
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
        ...(i < hops.length - 1 && h.linkProtocol
          ? { linkProtocol: h.linkProtocol as CascadeProtocol }
          : {}),
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
    setHops((prev) =>
      prev.length >= MAX_HOPS ? prev : [...prev, { nodeId: '', entryProtocol: '', linkProtocol: 'xray' }],
    );
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
      size="xl"
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

        <Group justify="space-between" align="center" mt="xs">
          <Text size="sm" fw={500}>
            {t('cascades.hops')}
          </Text>
          <Text size="xs" ff="monospace" c={hops.length >= MAX_HOPS ? 'orange' : 'dimmed'}>
            {hops.length}/{MAX_HOPS}
          </Text>
        </Group>
        <Stack gap={6}>
          {hops.map((h, i) => {
            const isEntry = i === 0;
            const isExit = i === hops.length - 1;
            const role = isEntry
              ? t('cascades.entry')
              : isExit
                ? t('cascades.exit')
                : t('cascades.transit');
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
                    style={{ flex: 1, minWidth: 180 }}
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
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={12} />}
          onClick={addHop}
          disabled={hops.length >= MAX_HOPS}
        >
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
