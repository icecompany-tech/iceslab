import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconCloud,
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconKey,
  IconLink,
  IconPlus,
  IconRocket,
  IconShieldLock,
  IconTrash,
  IconWorld,
} from '@tabler/icons-react';
import {
  createBinding,
  deleteBinding,
  listBindings,
  listHosts,
  listProfiles,
  listRegions,
  listSquads,
  updateBinding,
  getNodeExposure,
  registerNodeWarp,
  disableNodeWarp,
  apiErrorMessage,
  type Host,
  type Node as PanelNode,
  type NodeHardening,
  type NodeProtocol,
  type PortExposureResult,
  type UpdateNodeInput,
} from '../lib/api';
import { useOverview } from '../hooks/useOverview';
import { COUNTRY_OPTIONS, countryFlag } from '../lib/countries';
import { parseNodeAgentPort, pickFreeQuickDeployPort } from '../lib/ports';
import { HostsManager } from './HostsManager';

const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
];

// Disabled sing-box teaser after xray (roadmap signal; not installable yet).
// Separate from the typed PROTOCOL_OPTIONS so the sentinel never enters
// NodeProtocol form state.
const NODE_PROTOCOL_SELECT_DATA = [
  PROTOCOL_OPTIONS[0], // xray
  { value: '__singbox_soon', label: 'sing-box (soon)', disabled: true },
  ...PROTOCOL_OPTIONS.slice(1),
];

// Hard-coded mTLS port from install-iceslab-node.sh - also the default in the
// create wizard. Edit modal lets admin tweak per-node. Wave-13 bumped from
// 8443 to 1337 (see NodeFormModal.tsx for rationale).
const DEFAULT_NODE_PORT = 1337;

interface FormValues {
  name: string;
  // host + port - split for clearer UX (Remnawave-style). Recombined
  // into `host:port` on submit.
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
  // Slice 27.5 - region grouping + capacity hint.
  regionId: string;
  maxUsers: number | '';
  // B3/G - public FQDN for REALITY self-steal serverName + future ACME.
  domain: string;
  // G (Zashchita) - probe-resistance toggles, flattened into form state.
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}

/**
 * G - collapse the flat hardening fields into the NodeHardening blob the
 * backend persists. Returns null when nothing is enabled so the node keeps
 * hardening = NULL (install command unchanged).
 */
function buildHardening(v: FormValues): NodeHardening | null {
  const allow = v.hardenSshAllowlist.map((s) => s.trim()).filter(Boolean);
  const h: NodeHardening = {};
  if (v.hardenUfw) h.ufwLockdown = true;
  if (v.hardenFail2ban) h.fail2ban = true;
  if (v.hardenRealisticFallback) h.realisticFallback = true;
  if (allow.length > 0) h.sshAllowlist = allow;
  return Object.keys(h).length > 0 ? h : null;
}

function splitAddress(address: string): { host: string; port: number } {
  const idx = address.indexOf(':');
  if (idx === -1) return { host: address, port: DEFAULT_NODE_PORT };
  const host = address.slice(0, idx);
  const port = Number.parseInt(address.slice(idx + 1), 10);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_NODE_PORT,
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  node: PanelNode | null;
  onSubmit: (input: UpdateNodeInput) => Promise<void>;
  onDelete: () => void;
  onRefreshBootstrap: () => void;
  saving?: boolean;
  refreshing?: boolean;
}

export function NodeEditModal({
  opened,
  onClose,
  node,
  onSubmit,
  onDelete,
  onRefreshBootstrap,
  saving,
  refreshing,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = splitAddress(node?.address ?? '');
  const form = useForm<FormValues>({
    initialValues: {
      name: node?.name ?? '',
      host: initial.host,
      port: initial.port,
      protocol: node?.protocol ?? 'xray',
      countryCode: node?.countryCode ?? '',
      consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
      regionId: node?.regionId ?? '',
      maxUsers: node?.maxUsers ?? '',
      domain: node?.domain ?? '',
      hardenUfw: node?.hardening?.ufwLockdown ?? false,
      hardenFail2ban: node?.hardening?.fail2ban ?? false,
      hardenRealisticFallback: node?.hardening?.realisticFallback ?? false,
      hardenSshAllowlist: node?.hardening?.sshAllowlist ?? [],
    },
  });

  useEffect(() => {
    if (opened && node) {
      const { host, port } = splitAddress(node.address);
      form.setValues({
        name: node.name,
        host,
        port,
        protocol: node.protocol,
        countryCode: node.countryCode ?? '',
        consumptionMultiplier: Number(node.consumptionMultiplier),
        regionId: node.regionId ?? '',
        maxUsers: node.maxUsers ?? '',
        domain: node.domain ?? '',
        hardenUfw: node.hardening?.ufwLockdown ?? false,
        hardenFail2ban: node.hardening?.fail2ban ?? false,
        hardenRealisticFallback: node.hardening?.realisticFallback ?? false,
        hardenSshAllowlist: node.hardening?.sshAllowlist ?? [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, node]);

  // Regions list for the Select. Cached across modal opens; cheap query.
  const regionsQuery = useQuery({
    queryKey: ['regions'],
    queryFn: listRegions,
    enabled: opened,
  });

  // Live host-metrics + traffic — same source the cards on /nodes use.
  // Wave-14 #19: removed the modal's own 10s refetchInterval. NodesPage
  // (the only entry point to this modal) already polls the SAME cache key
  // at 15s, so the modal's poll was net-burst on the dashboard endpoint
  // for no UX gain. Modal piggybacks on parent's interval via shared cache.
  const overviewQuery = useOverview({ enabled: opened });
  const overviewNode = overviewQuery.data?.nodes.find((n) => n.id === node?.id);

  // G4 probe-exposure: on-demand diff of the node's open ufw ports vs the
  // expected set. Best-effort - the backend returns checked:false for an old
  // or unreachable agent, so a reachable node never errors here.
  const [exposure, setExposure] = useState<PortExposureResult | null>(null);
  const exposureMutation = useMutation({
    mutationFn: () => getNodeExposure(node!.id),
    onSuccess: setExposure,
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e) }),
  });
  useEffect(() => {
    setExposure(null);
  }, [opened, node]);

  // Bindings deployed on this node (with profile info inlined - `listBindings`
  // doesn't include profile name, so we cross-reference with `listProfiles`).
  const bindingsQuery = useQuery({
    queryKey: ['bindings', { nodeId: node?.id }],
    queryFn: () => listBindings({ nodeId: node!.id }),
    enabled: opened && node !== null,
  });
  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: opened,
  });

  // Squads - used to count users that can reach THIS node via squad → profile
  // → binding chain. Approximate (we sum memberCount across squads, can
  // overcount a user who's in multiple squads bound to the same node).
  // Good enough for an at-a-glance number; ground truth is dashboard's
  // dedup'd per-protocol counter.
  const squadsQuery = useQuery({
    queryKey: ['squads'],
    queryFn: () => listSquads(),
    enabled: opened,
  });
  // F7 - one batch fetch of every host across this node's bindings, replacing
  // the per-binding ['hosts', bindingId] query each HostsManager used to mount.
  const hostsQuery = useQuery({
    queryKey: ['hosts', 'node', node?.id],
    queryFn: () => listHosts({ nodeId: node!.id }),
    enabled: opened && node !== null,
  });
  const hostsByBinding = useMemo(() => {
    const m = new Map<string, Host[]>();
    for (const h of hostsQuery.data?.hosts ?? []) {
      const arr = m.get(h.bindingId);
      if (arr) arr.push(h);
      else m.set(h.bindingId, [h]);
    }
    return m;
  }, [hostsQuery.data]);
  const bindingsWithProfile = (bindingsQuery.data?.bindings ?? []).map((b) => {
    const p = (profilesQuery.data?.profiles ?? []).find((x) => x.id === b.profileId);
    return { binding: b, profile: p };
  });

  // Approximate "user reach" - squads that have at least one of this node's
  // profiles, summed by memberCount. Overcounts cross-squad shared users.
  const reachingUsersApprox = (() => {
    const profileIds = new Set(bindingsWithProfile.map((bp) => bp.binding.profileId));
    if (profileIds.size === 0) return 0;
    let sum = 0;
    for (const sq of squadsQuery.data?.squads ?? []) {
      if (sq.profileIds.some((pid) => profileIds.has(pid))) {
        sum += sq.memberCount;
      }
    }
    return sum;
  })();

  const removeBindingMutation = useMutation({
    mutationFn: deleteBinding,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      // F9 - do NOT invalidate ['dashboard'] here: it forces an immediate
      // recompute of the heavy ~20-query overview on every binding edit. The
      // overview polls every 30s on its own, which is fresh enough for the
      // node's binding count / today-bytes.
      notifications.show({ color: 'green', message: t('nodes.edit.bindingRemoved') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('nodes.edit.bindingRemoveFailed'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Update binding port - saves the new port via PUT /api/bindings/:id,
  // panel auto-re-pushes applyInbound to the node (worker fires on
  // binding change events). Avoids the "SQL UPDATE" dance admins
  // resorted to before this inline edit existed (cycle #6 2026-05-13).
  const updatePortMutation = useMutation({
    mutationFn: ({ id, port }: { id: string; port: number }) =>
      updateBinding(id, { port }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      notifications.show({ color: 'green', message: t('nodes.edit.bindingPortUpdated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('nodes.edit.bindingPortUpdateFailed'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Local draft state for per-binding port input - keyed on binding.id.
  // Initialized lazily on first edit; cleared after save.
  const [portDrafts, setPortDrafts] = useState<Record<string, number>>({});

  // F-P1-b "+ Add protocol": every profile not yet bound here is deployable,
  // NOT just ones matching the node's installed core. The old `p.protocol ===
  // form.values.protocol` gate is exactly why adding hy2 to an xray node from
  // the node modal was impossible (the chip never appeared). Now all show;
  // cross-protocol ones are flagged (binary may be absent -> callback-only).
  // Sorted matching-core-first so the "just works" options lead.
  const availableProfiles = (profilesQuery.data?.profiles ?? [])
    .filter((p) => !bindingsWithProfile.some((bp) => bp.binding.profileId === p.id))
    .sort((a, b) => {
      const am = a.protocol === node?.protocol ? 0 : 1;
      const bm = b.protocol === node?.protocol ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
  const nodeAgentPort = parseNodeAgentPort(node?.address);
  const addBindingMutation = useMutation({
    mutationFn: (profileId: string) => {
      const occupied = bindingsWithProfile.map((bp) => bp.binding.port);
      const reserved = nodeAgentPort !== null ? [nodeAgentPort] : [];
      const port = pickFreeQuickDeployPort(occupied, reserved);
      return createBinding({ profileId, nodeId: node!.id, port });
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      // F9 - skip the ['dashboard'] invalidation (heavy overview recompute);
      // the 30s poll keeps it fresh enough.
      notifications.show({
        color: 'green',
        message: t('nodes.edit.bindingAdded', { port: created.port }),
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('nodes.edit.bindingFailed'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // WARP egress (feat/warp-native) - register a free Cloudflare WARP device for
  // this node (enable) or turn egress off (disable). The Cloudflare call happens
  // server-side; on success we refetch so the switch reflects the new state.
  const warpMutation = useMutation({
    mutationFn: (enable: boolean) =>
      enable ? registerNodeWarp(node!.id) : disableNodeWarp(node!.id),
    onSuccess: (_, enable) => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      notifications.show({
        color: 'green',
        message: enable ? t('nodes.edit.warpEnabled') : t('nodes.edit.warpDisabled'),
      });
    },
    onError: (e) =>
      notifications.show({
        color: 'red',
        title: t('nodes.edit.warpFailed'),
        message: apiErrorMessage(e),
      }),
  });

  if (!node) return null;

  async function handleSave() {
    const portNum =
      form.values.port === '' ? DEFAULT_NODE_PORT : Number(form.values.port);
    const address = `${form.values.host.trim()}:${portNum}`;
    await onSubmit({
      name: form.values.name,
      address,
      protocol: form.values.protocol,
      countryCode: form.values.countryCode || null,
      consumptionMultiplier:
        form.values.consumptionMultiplier === ''
          ? 1
          : Number(form.values.consumptionMultiplier),
      regionId: form.values.regionId || null,
      maxUsers:
        form.values.maxUsers === '' ? null : Number(form.values.maxUsers),
      domain: form.values.domain.trim() || null,
      hardening: buildHardening(form.values),
    });
  }

  const m = overviewNode?.metrics;
  const statusColor =
    node.status === 'online' ? 'teal' : node.status === 'disabled' ? 'gray' : 'red';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
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
            <IconActivity size={18} />
          </Card>
          <Stack gap={4}>
            <Group gap={8} align="center">
              {node.countryCode && (
                <Text size="md" lh={1}>
                  {countryFlag(node.countryCode)}
                </Text>
              )}
              <Text style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
                {node.name}
              </Text>
              <Badge variant="light" color={statusColor} size="sm" tt="uppercase" style={{ letterSpacing: '0.08em', fontFamily: "'Geist Mono', monospace" }}>
                {node.status}
              </Badge>
            </Group>
            <Text
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {node.address} · ID {node.id.slice(0, 8)}
            </Text>
          </Stack>
        </Group>
      }
      size="xl"
    >
      <Stack>
        {/* Status row - parse `degraded: {...}` JSON and surface per-core
            status as readable badges instead of raw JSON noise. */}
        {node.lastStatusMessage &&
          (() => {
            const m = node.lastStatusMessage.match(/^degraded:\s*(\{.+\})/);
            if (!m) {
              return (
                <Alert color="yellow" variant="light" p="xs">
                  <Text size="xs" ff="monospace">
                    {node.lastStatusMessage}
                  </Text>
                </Alert>
              );
            }
            try {
              const parsed = JSON.parse(m[1]!) as {
                cores?: { name: string; running: boolean }[];
              };
              if (!parsed.cores) throw new Error('no cores');
              // Show only the core that matches this node's installed
              // protocol - agent reports all 7 adapter slots and most
              // are stubs ("✓ HYSTERIA" on an xray-only node is noise).
              // If the node is online and the relevant core is also
              // running, drop the alert entirely - no actionable
              // information for the admin.
              const relevant = parsed.cores.filter(
                (c) => c.name.toLowerCase() === node.protocol.toLowerCase(),
              );
              if (relevant.length === 0) return null;
              if (node.status === 'online' && relevant.every((c) => c.running)) {
                return null;
              }
              return (
                <Alert color="yellow" variant="light" p="xs">
                  <Group gap={6} wrap="wrap">
                    <Text size="xs" fw={500}>
                      {t('nodes.edit.coresLabel')}:
                    </Text>
                    {relevant.map((c) => (
                      <Badge
                        key={c.name}
                        size="xs"
                        variant="light"
                        color={c.running ? 'teal' : 'gray'}
                        tt="uppercase"
                      >
                        {c.running ? '✓' : '✗'} {c.name}
                      </Badge>
                    ))}
                  </Group>
                </Alert>
              );
            } catch {
              return (
                <Alert color="yellow" variant="light" p="xs">
                  <Text size="xs" ff="monospace">
                    {node.lastStatusMessage}
                  </Text>
                </Alert>
              );
            }
          })()}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {/* LEFT - параметры */}
          <Card withBorder padding="md" radius="md">
            <Group gap="sm" mb="md">
              <ThemeIcon size={32} radius="md" variant="light" color="blue">
                <IconWorld size={16} />
              </ThemeIcon>
              <Text fw={600}>{t('nodes.edit.params')}</Text>
            </Group>
            <Stack gap="sm">
              <Group grow align="flex-start">
                <TextInput
                  label={t('nodes.edit.paramsName')}
                  description={t('nodes.edit.paramsNameDesc')}
                  required
                  {...form.getInputProps('name')}
                />
                <Select
                  label={t('nodes.edit.paramsProtocol')}
                  description={t('nodes.edit.paramsProtocolDesc')}
                  data={NODE_PROTOCOL_SELECT_DATA}
                  allowDeselect={false}
                  {...form.getInputProps('protocol')}
                />
              </Group>
              <Group align="flex-end" gap="sm" wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  label={t('nodes.edit.paramsAddress')}
                  description={t('nodes.edit.paramsAddressDesc')}
                  required
                  {...form.getInputProps('host')}
                />
                <NumberInput
                  w={120}
                  label={t('nodes.edit.paramsPort')}
                  description={t('nodes.edit.paramsPortDesc')}
                  min={1}
                  max={65535}
                  allowDecimal={false}
                  allowNegative={false}
                  hideControls
                  {...form.getInputProps('port')}
                />
              </Group>
              <Group grow align="flex-end">
                <Select
                  label={t('nodes.edit.paramsCountry')}
                  description={t('nodes.edit.paramsCountryDesc')}
                  data={COUNTRY_OPTIONS}
                  searchable
                  clearable
                  placeholder={t('common.none')}
                  {...form.getInputProps('countryCode')}
                />
                <NumberInput
                  label={t('nodes.edit.paramsMultiplier')}
                  description={t('nodes.edit.paramsMultiplierDesc')}
                  min={0.1}
                  max={10}
                  step={0.1}
                  {...form.getInputProps('consumptionMultiplier')}
                />
              </Group>

              <Group grow align="flex-end">
                <Select
                  label={t('nodes.edit.paramsRegion')}
                  description={t('nodes.edit.paramsRegionDesc')}
                  placeholder={t('nodes.edit.paramsRegionPlaceholder')}
                  clearable
                  data={(regionsQuery.data?.regions ?? []).map((r) => ({
                    value: r.id,
                    label: `${r.code} · ${r.name}`,
                  }))}
                  {...form.getInputProps('regionId')}
                />
                <NumberInput
                  label={t('nodes.edit.paramsMaxUsers')}
                  description={t('nodes.edit.paramsMaxUsersDesc')}
                  placeholder={t('nodes.edit.paramsMaxUsersPlaceholder')}
                  min={1}
                  max={100000}
                  allowDecimal={false}
                  allowNegative={false}
                  {...form.getInputProps('maxUsers')}
                />
              </Group>
              <TextInput
                label={t('nodes.form.domain')}
                description={t('nodes.form.domainDesc')}
                placeholder="des-01.example.com"
                {...form.getInputProps('domain')}
              />

              {/* G (Zashchita) - probe-resistance toggles. Mirrors the create
                  wizard's HardeningSection; persisted to nodes.hardening. */}
              <Box mt="xs">
                <Group gap={8} mb="xs">
                  <ThemeIcon size={26} radius="md" variant="light" color="teal">
                    <IconShieldLock size={14} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Text fw={600} size="sm">
                      {t('nodes.form.hardeningSection')}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t('nodes.form.hardeningSectionDesc')}
                    </Text>
                  </Stack>
                </Group>
                <Stack gap="sm">
                  <Switch
                    label={t('nodes.form.hardeningUfw')}
                    description={t('nodes.form.hardeningUfwDesc')}
                    {...form.getInputProps('hardenUfw', { type: 'checkbox' })}
                  />
                  <Switch
                    label={t('nodes.form.hardeningFail2ban')}
                    description={t('nodes.form.hardeningFail2banDesc')}
                    {...form.getInputProps('hardenFail2ban', { type: 'checkbox' })}
                  />
                  <Switch
                    label={t('nodes.form.hardeningRealisticFallback')}
                    description={t('nodes.form.hardeningRealisticFallbackDesc')}
                    {...form.getInputProps('hardenRealisticFallback', {
                      type: 'checkbox',
                    })}
                  />
                  <TagsInput
                    label={t('nodes.form.hardeningSshAllowlist')}
                    description={t('nodes.form.hardeningSshAllowlistDesc')}
                    placeholder="203.0.113.4, 10.0.0.0/8"
                    clearable
                    {...form.getInputProps('hardenSshAllowlist')}
                  />
                </Stack>
              </Box>

              {/* WARP egress (feat/warp-native) - per-node toggle. Egress lives
                  in the xray wireguard outbound, so it's only shown on xray
                  nodes. Toggling hits the panel API (register/disable); the
                  Cloudflare device registration runs server-side, no form save. */}
              {node.protocol === 'xray' && (
                <Box mt="xs">
                  <Group gap={8} mb="xs">
                    <ThemeIcon size={26} radius="md" variant="light" color="orange">
                      <IconCloud size={14} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text fw={600} size="sm">
                        {t('nodes.edit.warpSection')}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t('nodes.edit.warpSectionDesc')}
                      </Text>
                    </Stack>
                  </Group>
                  <Switch
                    checked={node.warpEnabled}
                    disabled={warpMutation.isPending}
                    onChange={(e) => warpMutation.mutate(e.currentTarget.checked)}
                    label={t('nodes.edit.warpToggle')}
                    description={t('nodes.edit.warpToggleDesc')}
                  />
                </Box>
              )}
            </Stack>
          </Card>

          {/* RIGHT - система (live metrics) */}
          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" mb="md">
              <Group gap="sm">
                <ThemeIcon size={32} radius="md" variant="light" color="grape">
                  <IconCpu size={16} />
                </ThemeIcon>
                <Text fw={600}>{t('nodes.edit.system')}</Text>
              </Group>
              {m && (
                <Badge variant="light" color="gray" size="xs" ff="monospace">
                  uptime {formatUptime(m.uptimeSeconds)}
                </Badge>
              )}
            </Group>
            {m ? (
              <Stack gap="xs">
                <MetricBar
                  icon={<IconCpu size={12} />}
                  label="CPU"
                  value={m.cpu.usagePercent}
                  detail={t('nodes.edit.cpuHint', {
                    cores: m.cpu.cores,
                    la: `${m.cpu.loadAvg1.toFixed(2)}/${m.cpu.loadAvg5.toFixed(2)}/${m.cpu.loadAvg15.toFixed(2)}`,
                  })}
                />
                <MetricBar
                  icon={<IconDatabase size={12} />}
                  label="RAM"
                  value={m.memory.usedPercent}
                  detail={`${formatBytes(m.memory.usedBytes)} / ${formatBytes(m.memory.totalBytes)}`}
                />
                <MetricBar
                  icon={<IconDeviceFloppy size={12} />}
                  label="Disk"
                  value={m.disk.usedPercent}
                  detail={`${formatBytes(m.disk.usedBytes)} / ${formatBytes(m.disk.totalBytes)}`}
                />
                <Divider my={4} />
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {t('nodes.edit.todayBytes')}
                  </Text>
                  <Text size="sm" fw={600} ff="monospace">
                    {formatBytes(overviewNode?.todayBytes ?? 0)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {t('nodes.edit.bindings')}
                  </Text>
                  <Text size="sm" fw={600}>
                    {overviewNode?.inboundCount ?? bindingsWithProfile.length}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {t('nodes.edit.reachingUsers')}
                  </Text>
                  <Text size="sm" fw={600}>
                    {reachingUsersApprox === 0 ? '-' : `~${reachingUsersApprox}`}
                  </Text>
                </Group>
              </Stack>
            ) : (
              <Text size="xs" c="dimmed" ta="center" py="xl">
                {t('nodes.metricsLoading')}
              </Text>
            )}
            {/* G4 probe-exposure: open ufw ports vs the expected set. */}
            <Divider my="xs" />
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed">
                {t('nodes.edit.exposureLabel')}
              </Text>
              <Button
                size="xs"
                variant="light"
                color="grape"
                leftSection={<IconShieldLock size={14} />}
                loading={exposureMutation.isPending}
                onClick={() => exposureMutation.mutate()}
              >
                {t('nodes.edit.exposureCheck')}
              </Button>
            </Group>
            {exposure &&
              (exposure.checked ? (
                (exposure.extras?.length ?? 0) > 0 ? (
                  <Alert color="yellow" variant="light" p="xs" icon={<IconAlertTriangle size={14} />}>
                    <Text size="xs">
                      {t('nodes.edit.exposureExtra', { ports: exposure.extras!.join(', ') })}
                    </Text>
                  </Alert>
                ) : (
                  <Alert color="green" variant="light" p="xs" icon={<IconCheck size={14} />}>
                    <Text size="xs">{t('nodes.edit.exposureClean')}</Text>
                  </Alert>
                )
              ) : (
                <Text size="xs" c="dimmed">
                  {t('nodes.edit.exposureSkipped', { note: exposure.note ?? '' })}
                </Text>
              ))}
          </Card>
        </SimpleGrid>

        {/* Bindings - what's deployed on this node */}
        <Card withBorder padding="md" radius="md">
          <Group justify="space-between" mb="sm">
            <Group gap="sm">
              <ThemeIcon size={32} radius="md" variant="light" color="violet">
                <IconRocket size={16} />
              </ThemeIcon>
              <Text fw={600}>{t('nodes.edit.bindingsCount', { count: bindingsWithProfile.length })}</Text>
            </Group>
          </Group>

          {bindingsWithProfile.length === 0 ? (
            <Text size="xs" c="dimmed" py="md" ta="center">
              {t('nodes.edit.noBindings')}
            </Text>
          ) : (
            <Stack gap={4}>
              {bindingsWithProfile.map(({ binding, profile }) => (
                <Paper
                  key={binding.id}
                  withBorder
                  p="xs"
                  radius="sm"
                  style={{
                    borderLeft: `3px solid var(--mantine-color-violet-6)`,
                  }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <IconBolt size={14} />
                      <Stack gap={0}>
                        <Group gap={6}>
                          <Text size="sm" fw={500} truncate>
                            {profile?.name ?? '<unknown>'}
                          </Text>
                          <Badge variant="light" color="cyan" size="xs" tt="uppercase">
                            {profile?.protocol ?? '?'}
                          </Badge>
                          {/* Inline port edit - admin types new port and clicks save.
                              Was the #1 UX pain point pre-cycle-6 (admins SQL'd the
                              port directly because UI had no edit affordance). */}
                          {(() => {
                            const draft = portDrafts[binding.id];
                            const effectivePort = draft ?? binding.port;
                            const conflictsWithAgent =
                              nodeAgentPort !== null && effectivePort === nodeAgentPort;
                            // Bug #11: also reject a port already used by ANOTHER
                            // binding on this node (same (node, port) -> EADDRINUSE
                            // at adapter start), not just the node-agent port.
                            const conflictsWithBinding = bindingsWithProfile.some(
                              (bp) =>
                                bp.binding.id !== binding.id &&
                                bp.binding.port === effectivePort,
                            );
                            const conflict = conflictsWithAgent || conflictsWithBinding;
                            const conflictLabel = conflictsWithAgent
                              ? t('nodes.edit.bindingPortAgentConflict', { port: nodeAgentPort })
                              : t('nodes.edit.bindingPortBindingConflict', { port: effectivePort });
                            return (
                          <Group gap={2} wrap="nowrap">
                            <Text size="xs" c="dimmed" ff="monospace">:</Text>
                            <Tooltip
                              label={conflictLabel}
                              disabled={!conflict}
                              color="red"
                            >
                              <NumberInput
                                size="xs"
                                w={72}
                                min={1}
                                max={65535}
                                hideControls
                                error={conflict}
                                value={portDrafts[binding.id] ?? binding.port}
                                onChange={(v) =>
                                  setPortDrafts((d) => ({
                                    ...d,
                                    [binding.id]: typeof v === 'number' ? v : Number(v) || binding.port,
                                  }))
                                }
                                styles={{ input: { fontFamily: 'monospace', textAlign: 'center' } }}
                              />
                            </Tooltip>
                            {portDrafts[binding.id] !== undefined &&
                              portDrafts[binding.id] !== binding.port &&
                              !conflict && (
                                <Tooltip label={t('nodes.edit.bindingPortSave')}>
                                  <ActionIcon
                                    size="sm"
                                    variant="light"
                                    color="green"
                                    loading={
                                      updatePortMutation.isPending &&
                                      updatePortMutation.variables?.id === binding.id
                                    }
                                    onClick={() => {
                                      const next = portDrafts[binding.id];
                                      if (next && next !== binding.port) {
                                        updatePortMutation.mutate(
                                          { id: binding.id, port: next },
                                          {
                                            onSuccess: () =>
                                              setPortDrafts((d) => {
                                                const clone = { ...d };
                                                delete clone[binding.id];
                                                return clone;
                                              }),
                                          },
                                        );
                                      }
                                    }}
                                  >
                                    <IconCheck size={12} />
                                  </ActionIcon>
                                </Tooltip>
                              )}
                          </Group>
                            );
                          })()}
                        </Group>
                        {binding.publicHost && (
                          <Text size="xs" c="dimmed" ff="monospace">
                            override: {binding.publicHost}
                          </Text>
                        )}
                      </Stack>
                    </Group>
                    <Tooltip label={t('nodes.edit.removeBindingTooltip')}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        loading={
                          removeBindingMutation.isPending &&
                          removeBindingMutation.variables === binding.id
                        }
                        onClick={() => removeBindingMutation.mutate(binding.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  {profile && (
                    <Box mt="xs" pl="xl">
                      {/* F-P1-b: label the host sub-level so "add host" (an
                          access variant: SNI/fingerprint) reads as nested under
                          the binding (the protocol), not as "add protocol". */}
                      <Text
                        mb={4}
                        style={{
                          fontFamily: "'Geist Mono', monospace",
                          fontSize: 9,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: '#7A8BA3',
                        }}
                      >
                        {t('nodes.edit.hostsLabel')}
                      </Text>
                      <HostsManager
                        bindingId={binding.id}
                        protocol={profile.protocol}
                        hosts={hostsByBinding.get(binding.id) ?? []}
                        nodeId={node.id}
                        loading={hostsQuery.isLoading}
                      />
                    </Box>
                  )}
                </Paper>
              ))}
            </Stack>
          )}

          {availableProfiles.length > 0 && (
            <Box mt="md">
              <Divider
                mb="sm"
                labelPosition="left"
                label={
                  <Group gap={6}>
                    <IconPlus size={12} />
                    <Text size="xs" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em' }}>
                      {t('nodes.edit.addProtocolLabel')}
                    </Text>
                  </Group>
                }
              />
              <Text size="xs" c="dimmed" mb={6}>
                {t('nodes.edit.addProtocolHint')}
              </Text>
              <Group gap={6} wrap="wrap">
                {availableProfiles.map((p) => {
                  // Cross-protocol = the node's installed core differs, so the
                  // protocol binary is likely absent and the agent runs the
                  // inbound callback-only until it's installed (SSH / F-P2).
                  const mismatch = p.protocol !== node.protocol;
                  return (
                    <Tooltip
                      key={p.id}
                      label={
                        mismatch
                          ? t('nodes.edit.addProtocolMismatch', {
                              protocol: p.protocol,
                              node: node.protocol,
                            })
                          : t('nodes.edit.addProtocolMatch', { protocol: p.protocol })
                      }
                      multiline
                      w={280}
                    >
                      <Button
                        variant="light"
                        color={mismatch ? 'yellow' : 'violet'}
                        size="xs"
                        leftSection={
                          mismatch ? <IconAlertTriangle size={12} /> : <IconLink size={12} />
                        }
                        rightSection={
                          <Text span size="9px" ff="monospace" tt="uppercase" style={{ opacity: 0.7 }}>
                            {p.protocol}
                          </Text>
                        }
                        loading={
                          addBindingMutation.isPending &&
                          addBindingMutation.variables === p.id
                        }
                        // Bug #5: disable ALL chips while any add is in flight.
                        // The mutationFn computes the free port from the rendered
                        // bindings list; two rapid clicks both see the pre-add
                        // list and both pick 443 -> second 409s. Forcing sequential
                        // adds means each click sees the prior binding (refetched
                        // on success) and picks the next free port.
                        disabled={addBindingMutation.isPending}
                        onClick={() => addBindingMutation.mutate(p.id)}
                      >
                        {p.name}
                      </Button>
                    </Tooltip>
                  );
                })}
              </Group>
            </Box>
          )}
        </Card>

        {/* Action footer */}
        <Group justify="space-between">
          <Group gap="xs">
            <Button
              variant="light"
              color="blue"
              leftSection={<IconKey size={14} />}
              loading={refreshing}
              onClick={onRefreshBootstrap}
            >
              {t('nodes.edit.refreshBootstrapBtn')}
            </Button>
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={onDelete}
            >
              {t('nodes.edit.deleteBtn')}
            </Button>
          </Group>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {t('common.save')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function MetricBar({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  const color = value > 85 ? 'red' : value > 60 ? 'yellow' : 'teal';
  return (
    <Box>
      <Group gap={6} mb={2}>
        <Box style={{ color: `var(--mantine-color-${color}-5)`, display: 'flex' }}>
          {icon}
        </Box>
        <Text size="xs" fw={500} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          {detail}
        </Text>
        <Text size="xs" fw={700}>
          {value.toFixed(0)}%
        </Text>
      </Group>
      <Progress value={value} color={color} size="sm" radius="xs" />
    </Box>
  );
}

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
