import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconRocket, IconServer2 } from '@tabler/icons-react';
import { apiErrorMessage } from '@/lib/net/client';
import {
  createBinding,
  deleteBinding,
  getNextFreePort,
  listBindings,
  type Binding,
  type Profile,
} from '@/lib/domain/profiles';
import { listNodes, type Node as PanelNode } from '@/lib/domain/nodes';
import {
  engineCoreWord,
  engineListWords,
  nodeRunsEngine,
  type EngineName,
} from '@/lib/domain/engines';

interface Props {
  profile: Profile | null;
  onClose: () => void;
}

export function DeployProfileModal({ profile, onClose }: Props) {
  const { t } = useTranslation();
  const opened = profile !== null;
  const qc = useQueryClient();

  const nodesQuery = useQuery({
    // F8 - distinct key. NodesPage caches ['nodes', regionFilter] and with the
    // default region that's ['nodes', 'all'] - the same key this modal used,
    // but a different queryFn shape. Namespacing avoids the two clobbering each
    // other's cache.
    queryKey: ['nodes', 'deploy-picker'],
    queryFn: () => listNodes({ limit: 100 }),
    enabled: opened,
  });

  const bindingsQuery = useQuery({
    queryKey: ['bindings', { profileId: profile?.id }],
    queryFn: () => listBindings({ profileId: profile!.id }),
    enabled: opened && profile !== null,
  });

  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      set.add(b.nodeId);
    }
    return set;
  }, [bindingsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (opened) setSelected(new Set(initialSelected));
  }, [opened, initialSelected]);

  const defaultPort = useMemo(() => {
    const cfg = profile?.config as { port?: number } | undefined;
    return cfg?.port ?? 443;
  }, [profile]);

  // Port admin chooses for NEW bindings created in this modal session.
  // Existing bindings keep their port - admin edits them inline in
  // Nodes → Edit. Initialized to the profile default on each open.
  const [port, setPort] = useState<number>(defaultPort);
  // F-P1-b: once the admin types a port, stop auto-suggesting so we don't
  // clobber their choice. Reset on each open.
  const [portTouched, setPortTouched] = useState(false);
  useEffect(() => {
    if (opened) {
      setPort(defaultPort);
      setPortTouched(false);
    }
  }, [opened, defaultPort]);

  // F-P1-b auto-free-port: when the admin picks a node that isn't deployed yet,
  // suggest the next free port on it instead of blindly reusing 443 (which
  // 409s the moment that node already runs a protocol). Skips if the admin
  // already typed their own port this session. Uses the FIRST newly-selected
  // node; a port free there may still collide on another node in a multi-select,
  // but the human-readable 409 (F-P1) covers that edge.
  const firstNewNodeId = useMemo(() => {
    for (const id of selected) if (!initialSelected.has(id)) return id;
    return null;
  }, [selected, initialSelected]);
  useEffect(() => {
    if (!opened || portTouched || firstNewNodeId === null) return;
    let cancelled = false;
    getNextFreePort(firstNewNodeId)
      .then((p) => {
        if (!cancelled) setPort(p);
      })
      .catch(() => {
        /* fall back to the current value; createBinding still guards the port */
      });
    return () => {
      cancelled = true;
    };
  }, [opened, portTouched, firstNewNodeId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      const bindings = bindingsQuery.data?.bindings ?? [];
      const byNodeId = new Map<string, Binding>();
      for (const b of bindings) byNodeId.set(b.nodeId, b);

      const toCreate: string[] = [];
      const toDelete: string[] = [];

      for (const nodeId of selected) {
        if (!byNodeId.has(nodeId)) toCreate.push(nodeId);
      }
      for (const b of bindings) {
        if (!selected.has(b.nodeId)) toDelete.push(b.id);
      }

      await Promise.all([
        ...toCreate.map((nodeId) =>
          createBinding({
            profileId: profile.id,
            nodeId,
            port,
          }),
        ),
        ...toDelete.map((id) => deleteBinding(id)),
      ]);

      return { created: toCreate.length, deleted: toDelete.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      const c = result?.created ?? 0;
      const d = result?.deleted ?? 0;
      if (c === 0 && d === 0) {
        notifications.show({ color: 'gray', message: t('profiles.deploy.noChanges') });
      } else {
        notifications.show({
          color: 'green',
          message: t('profiles.deploy.saved', { added: c, removed: d }),
        });
      }
      onClose();
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: apiErrorMessage(err),
      }),
  });

  function toggle(nodeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const nodes = nodesQuery.data?.nodes ?? [];
  const dirty = useMemo(() => {
    if (selected.size !== initialSelected.size) return true;
    for (const id of selected) if (!initialSelected.has(id)) return true;
    return false;
  }, [selected, initialSelected]);

  const loading = nodesQuery.isLoading || bindingsQuery.isLoading;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconRocket size={18} />
          <Text fw={600}>{t('profiles.deploy.title', { name: profile?.name ?? '' })}</Text>
        </Group>
      }
      size="lg"
    >
      <Stack>
        <Alert color="blue" variant="light">
          {t('profiles.deploy.hint', { port })}
        </Alert>

        {/* Port input for new bindings created here. Existing bindings
            keep their old port; to change an existing binding's port,
            admin goes to Nodes → Edit → inline edit in the Bindings
            list. Per AmneziaWG upstream: prefer <= 9999 ports (some
            ISPs block high UDP), avoid 51820 (well-known WG default
            targeted by DPI). */}
        <NumberInput
          label={t('profiles.deploy.port')}
          description={
            profile?.protocol === 'amneziawg'
              ? t('profileForm.deployHintAwgPort')
              : t('profiles.deploy.portAutoHint')
          }
          min={1}
          max={65535}
          value={port}
          onChange={(v) => {
            setPortTouched(true);
            setPort(typeof v === 'number' ? v : Number(v) || defaultPort);
          }}
        />

        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : nodes.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            {t('profiles.deploy.noNodes')}
          </Text>
        ) : (
          <Stack gap="xs">
            {nodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                wanted={profile?.effectiveEngine ?? null}
                checked={selected.has(node.id)}
                onToggle={() => toggle(node.id)}
              />
            ))}
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saveMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!dirty || loading}
            leftSection={<IconRocket size={14} />}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function NodeRow({
  node,
  wanted,
  checked,
  onToggle,
}: {
  node: PanelNode;
  /** The engine that will actually render this profile, resolved by the server.
   *  Null only while the profile itself has not loaded. */
  wanted: EngineName | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const statusColor =
    node.status === 'online' ? 'teal' : node.status === 'disabled' ? 'gray' : 'red';
  /**
   * Will a core on this node render this profile: membership of the profile's
   * effective engine in the engines the node REPORTED.
   *
   * Three answers, and the third is the one this row used to get wrong. It
   * compared `node.protocol` with the profile's protocol, which reads a LABEL
   * as a restriction: `protocol` says which adapter was installed as primary,
   * and a node labelled `tuic` serves an xray profile beside it every day. The
   * backend measured that same reading as a gate on 2026-09-11 and it refused
   * 23 legitimate pairs.
   *
   * undefined = the node has never reported its cores, so nothing is claimed:
   * no warning, no reassurance, no colour. Today that is the whole fleet.
   */
  const runs = wanted ? nodeRunsEngine(node, wanted) : undefined;
  const willNotRun = runs === false;
  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      style={{
        cursor: 'pointer',
        borderColor: willNotRun ? 'var(--mantine-color-yellow-6)' : undefined,
      }}
      onClick={onToggle}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Checkbox checked={checked} onChange={onToggle} tabIndex={-1} />
          <IconServer2 size={16} />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>
              {node.name}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {node.address}
            </Text>
          </Stack>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {node.countryCode && (
            <Badge variant="light" size="sm">
              {node.countryCode}
            </Badge>
          )}
          {/* The badge answers one question: will this node run this profile.
              While the node has never reported its cores there is no answer, so
              the row shows the label it does have, greyed, and says in the
              tooltip that this is a label rather than a capability. */}
          <Tooltip
            label={
              runs === undefined
                ? t('profileForm.nodeEnginesUnknown', { protocol: node.protocol })
                : willNotRun
                  ? t('profileForm.nodeWillNotRun', {
                      wanted: wanted ? engineCoreWord(wanted, t) : '',
                      engines: engineListWords(node, t),
                    })
                  : t('profileForm.nodeWillRun', {
                      wanted: wanted ? engineCoreWord(wanted, t) : '',
                    })
            }
            multiline
            w={300}
          >
            <Badge
              variant={willNotRun ? 'filled' : 'light'}
              color={willNotRun ? 'yellow' : runs === true ? 'cyan' : 'gray'}
              size="sm"
              tt="uppercase"
            >
              {willNotRun ? `⚠ ${engineListWords(node, t)}` : runs === true ? engineListWords(node, t) : node.protocol}
            </Badge>
          </Tooltip>
          <Tooltip label={node.lastStatusMessage ?? node.status}>
            <Badge variant="dot" color={statusColor} size="sm">
              {node.status}
            </Badge>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
