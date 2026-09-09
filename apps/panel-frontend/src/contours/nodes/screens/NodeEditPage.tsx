import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, NumberInput, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteHost,
  deleteNode,
  disableNodeWarp,
  findNode,
  getNodeExposure,
  listBindings,
  listCascades,
  listHosts,
  listNodes,
  listProfiles,
  listRegions,
  listRoutePolicies,
  listSquads,
  refreshNodeBootstrap,
  registerNodeWarp,
  updateNode,
  type Cascade,
  type Node,
  type NodeProtocol,
  type RoutePolicy,
} from '@/lib/net/api';
import { COUNTRY_OPTIONS, countryFlag } from '@/lib/domain/countries';
import { useOverview } from '@/lib/domain/dashboard';
import { usePageMeta } from '@/lib/ui/usePageMeta';

/**
 * A registered node, as a page with tabs. Parameters is what the panel stores
 * about the machine; Routes is what leaves through it. The two never share a
 * screen because they answer different questions and are saved separately.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const CYAN2 = '#67E8F9';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

const DEFAULT_NODE_PORT = 1337;

const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'anytls', label: 'AnyTLS' },
  { value: 'shadowtls', label: 'ShadowTLS' },
];

/** Hint under a field belongs below it, the way the artboard reads. */
const FIELD = {
  inputWrapperOrder: ['label', 'input', 'description', 'error'] as (
    | 'label'
    | 'input'
    | 'description'
    | 'error'
  )[],
  styles: {
    description: { color: FAINT, fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', marginTop: 6 },
  },
};

interface FormValues {
  name: string;
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  regionId: string;
  consumptionMultiplier: number | '';
  maxUsers: number | '';
}

function splitAddress(address: string): { host: string; port: number } {
  const idx = address.lastIndexOf(':');
  if (idx === -1) return { host: address, port: DEFAULT_NODE_PORT };
  const port = Number.parseInt(address.slice(idx + 1), 10);
  return {
    host: address.slice(0, idx),
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_NODE_PORT,
  };
}

function defaults(node: Node | null): FormValues {
  const { host, port } = splitAddress(node?.address ?? '');
  return {
    name: node?.name ?? '',
    host,
    port,
    protocol: node?.protocol ?? 'xray',
    countryCode: node?.countryCode ?? '',
    regionId: node?.regionId ?? '',
    consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
    maxUsers: node?.maxUsers ?? '',
  };
}

export function NodeEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'params' | 'routes'>('params');

  const nodesQuery = useQuery({
    queryKey: ['node', id],
    queryFn: () => findNode(id!),
    enabled: !!id,
  });
  const node = nodesQuery.data ?? null;

  const regionsQuery = useQuery({ queryKey: ['regions'], queryFn: listRegions });
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  // The fleet, for naming a cascade's directions after the country of the node
  // under each one. Shares the cache key every other page already uses.
  const fleetQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 100 }) });
  const bindingsQuery = useQuery({
    queryKey: ['bindings', id],
    queryFn: () => listBindings({ nodeId: id }),
    enabled: !!id,
  });
  const hostsQuery = useQuery({
    queryKey: ['hosts', id],
    queryFn: () => listHosts({ nodeId: id }),
    enabled: !!id,
  });
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() });
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const policiesQuery = useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies });
  const overviewQuery = useOverview();

  const form = useForm<FormValues>({
    initialValues: defaults(node),
    validateInputOnBlur: true,
    validate: {
      name: (v) => {
        const trimmed = v.trim();
        if (trimmed.length === 0) return t('validation.nameRequired');
        if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return t('validation.nameLatinOnly');
        return null;
      },
      host: (v) => {
        const trimmed = v.trim();
        if (trimmed.length === 0) return t('validation.addressRequired');
        if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) return t('validation.addressHostOnly');
        return null;
      },
      port: (v) => {
        if (v === '') return t('validation.portRequired');
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 65535) return t('validation.portRange');
        return null;
      },
    },
  });

  // Seed the form once the node lands, without clobbering edits in flight.
  const [seeded, setSeeded] = useState(false);
  if (node && !seeded) {
    form.setValues(defaults(node));
    form.resetDirty(defaults(node));
    setSeeded(true);
  }

  usePageMeta([node?.name ?? '']);

  const dashNode = overviewQuery.data?.nodes.find((n) => n.id === id);
  const metrics = dashNode?.metrics ?? null;

  // A node sits in at most one cascade; the hop's position names its role.
  const cascade = useMemo(() => {
    for (const c of cascadesQuery.data?.cascades ?? []) {
      const idx = c.hops.findIndex((h) => h.nodeId === id);
      if (idx === -1) continue;
      const role = idx === 0 ? 'entry' : idx === c.hops.length - 1 ? 'exit' : 'transit';
      // What this node feeds is a set of DIRECTIONS, named by the country a
      // client picks, not the next machine in a list. The node under a
      // direction can be swapped without any of this changing.
      const exits = c.mode === 'balancer' ? c.hops.slice(1) : c.hops.slice(-1);
      const directions = exits
        .map((h) => fleetQuery.data?.nodes.find((n) => n.id === h.nodeId)?.countryCode)
        .filter((code): code is string => Boolean(code))
        .map((code) => code.toUpperCase());
      return { cascade: c, role, directions: role === 'exit' ? [] : directions };
    }
    return null;
  }, [cascadesQuery.data, fleetQuery.data, id]);

  // Route profiles exist only where the panel builds them: the entry of an
  // enabled balancer cascade. Everywhere else the node carries no rule set.
  const isBalancerEntry =
    !!cascade && cascade.role === 'entry' && cascade.cascade.mode === 'balancer' && cascade.cascade.enabled;

  // Which ad-split policies can actually be picked on this node: the ones
  // granted to a squad that can reach a profile bound here. Both the policy and
  // the squads that brought it are kept, so each row can name its source.
  const reachablePolicies = useMemo(() => {
    if (!isBalancerEntry) return [];
    const boundProfiles = new Set((bindingsQuery.data?.bindings ?? []).map((b) => b.profileId));
    const bySource = new Map<string, { policy: RoutePolicy; squads: string[] }>();
    for (const squad of squadsQuery.data?.squads ?? []) {
      if (!squad.profileIds.some((pid) => boundProfiles.has(pid))) continue;
      for (const pid of squad.policyIds) {
        const policy = (policiesQuery.data?.policies ?? []).find((p) => p.id === pid);
        if (!policy) continue;
        const row = bySource.get(pid) ?? { policy, squads: [] };
        row.squads.push(squad.name);
        bySource.set(pid, row);
      }
    }
    return [...bySource.values()].sort((a, b) => a.policy.ordinal - b.policy.ordinal);
  }, [isBalancerEntry, bindingsQuery.data, squadsQuery.data, policiesQuery.data]);

  const profileById = useMemo(
    () => new Map((profilesQuery.data?.profiles ?? []).map((p) => [p.id, p] as const)),
    [profilesQuery.data],
  );
  const bindingById = useMemo(
    () => new Map((bindingsQuery.data?.bindings ?? []).map((b) => [b.id, b] as const)),
    [bindingsQuery.data],
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const port = form.values.port === '' ? DEFAULT_NODE_PORT : Number(form.values.port);
      return updateNode(id!, {
        name: form.values.name.trim(),
        address: `${form.values.host.trim()}:${port}`,
        protocol: form.values.protocol,
        countryCode: form.values.countryCode || null,
        regionId: form.values.regionId || null,
        consumptionMultiplier:
          form.values.consumptionMultiplier === '' ? 1 : Number(form.values.consumptionMultiplier),
        maxUsers: form.values.maxUsers === '' ? null : Number(form.values.maxUsers),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['node', id] });
      form.resetDirty(form.values);
      notifications.show({ color: 'green', message: t('nodes.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const warpMutation = useMutation({
    mutationFn: (on: boolean) => (on ? registerNodeWarp(id!) : disableNodeWarp(id!)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nodes'] }),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('nodes.form.warpError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const exposureMutation = useMutation({
    mutationFn: () => getNodeExposure(id!),
  });

  const bootstrapMutation = useMutation({
    mutationFn: () => refreshNodeBootstrap(id!),
    onSuccess: (info) => {
      void navigator.clipboard.writeText(info.command).catch(() => undefined);
      notifications.show({
        color: 'green',
        title: t('nodeEdit.bootstrapIssued'),
        message: t('nodeEdit.bootstrapCopied'),
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.error'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  if (!node) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Stack align="center" gap={14}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
            {nodesQuery.isLoading ? t('common.loading') : t('nodeEdit.notFound')}
          </Text>
          {!nodesQuery.isLoading && (
            <PlainButton onClick={() => navigate('/nodes')}>{t('nodeEdit.backToList')}</PlainButton>
          )}
        </Stack>
      </Box>
    );
  }

  const statusTone = node.status === 'online' ? MOSS : node.status === 'offline' ? DIM : AMBER;
  const warpOn = node.warpEnabled;
  const egress: 'direct' | 'warp' | 'cascade' = cascade ? 'cascade' : warpOn ? 'warp' : 'direct';

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 64,
          padding: '8px 8px 8px 14px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 11, paddingRight: 14, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${MOSS}1A`,
              border: `1px solid ${MOSS}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ServerIcon size={18} color={MOSS} />
          </Box>
          {node.countryCode && (
            <Text style={{ fontSize: 15, lineHeight: '15px' }}>{countryFlag(node.countryCode)}</Text>
          )}
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {node.name}
          </Text>
        </Box>
        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, paddingLeft: 14 }}>
          <DotChip color={statusTone}>{node.status}</DotChip>
          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>{node.address}</Text>
          {cascade && (
            <>
              <Sep />
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 20,
                  paddingInline: 8,
                  borderRadius: 5,
                  backgroundColor: `${VIOLET}1A`,
                  border: `1px solid ${VIOLET}33`,
                }}
              >
                <ChainIcon size={13} color={VIOLET} />
                <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: VIOLET }}>
                  {cascade.cascade.name} · {t(`nodeEdit.role.${cascade.role}`)}
                </Text>
              </Box>
            </>
          )}
          {/* Unsaved work is stated in the bar, not implied by an enabled
              button: the Save button looks the same either way. */}
          {form.isDirty() && (
            <>
              <Sep />
              <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER }} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: AMBER,
                  }}
                >
                  {t('nodeEdit.unsaved')}
                </Text>
              </Box>
            </>
          )}
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, flexShrink: 0 }}>
          <PlainButton icon="key" strong onClick={() => bootstrapMutation.mutate()}>
            {t('nodeEdit.reissue')}
          </PlainButton>
          <UnstyledButton
            type="button"
            onClick={() =>
              modals.openConfirmModal({
                title: t('nodes.deleteTitle', { name: node.name }),
                children: <Text size="sm">{t('nodes.deleteBody')}</Text>,
                labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                  await deleteNode(node.id);
                  qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['node', id] });
                  navigate('/nodes');
                },
              })
            }
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              backgroundColor: WELL,
              border: `1px solid ${HAIRLINE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <TrashIcon size={15} color={RED} />
          </UnstyledButton>
          <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />
          <PlainButton onClick={() => navigate('/nodes')}>{t('common.cancel')}</PlainButton>
          <PlainButton
            icon="tick"
            strong
            disabled={saveMutation.isPending}
            onClick={() => {
              if (!form.validate().hasErrors) saveMutation.mutate();
            }}
          >
            {t('common.save')}
          </PlainButton>
        </Box>
      </Box>

      {/* Tabs */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <TabButton active={tab === 'params'} onClick={() => setTab('params')} icon="server">
          {t('nodeEdit.tabParams')}
        </TabButton>
        <TabButton
          active={tab === 'routes'}
          onClick={() => setTab('routes')}
          icon="route"
          badge={cascade ? 1 : 0}
        >
          {t('nodeEdit.tabRoutes')}
        </TabButton>
      </Box>

      {tab === 'params' && (
        <>
          <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
              <Stack
                gap={16}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ServerIcon size={15} color={CYAN} />
                  <Caption>{t('nodeEdit.paramsTitle')}</Caption>
                </Box>

                <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                  <TextInput
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.name')}
                    description={t('nodes.form.nameDesc')}
                    required
                    {...form.getInputProps('name')}
                  />
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.protocol')}
                    description={t('nodeEdit.protocolDesc')}
                    data={PROTOCOL_OPTIONS}
                    allowDeselect={false}
                    {...form.getInputProps('protocol')}
                  />
                </Box>

                <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                  <TextInput
                    {...FIELD}
                    style={{ flex: 2, minWidth: 0 }}
                    label={t('nodes.form.address')}
                    description={t('nodeEdit.addressDesc')}
                    required
                    {...form.getInputProps('host')}
                  />
                  <NumberInput
                    {...FIELD}
                    style={{ width: 130, flexShrink: 0 }}
                    label={t('nodes.form.port')}
                    description={t('nodeEdit.portDesc')}
                    min={1}
                    max={65535}
                    allowDecimal={false}
                    allowNegative={false}
                    hideControls
                    {...form.getInputProps('port')}
                  />
                </Box>

                <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.country')}
                    description={t('nodes.form.countryDesc')}
                    placeholder={t('nodeCreate.countryPlaceholder')}
                    data={COUNTRY_OPTIONS}
                    searchable
                    clearable
                    nothingFoundMessage={t('common.nothingFound')}
                    {...form.getInputProps('countryCode')}
                  />
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodeEdit.region')}
                    description={t('nodeEdit.regionDesc')}
                    placeholder={t('nodeEdit.noRegion')}
                    data={(regionsQuery.data?.regions ?? []).map((r) => ({
                      value: r.id,
                      label: `${r.code} · ${r.name}`,
                    }))}
                    clearable
                    {...form.getInputProps('regionId')}
                  />
                  <NumberInput
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodeEdit.multiplier')}
                    description={t('nodeEdit.multiplierDesc')}
                    min={0.1}
                    max={10}
                    step={0.1}
                    decimalScale={1}
                    fixedDecimalScale
                    allowNegative={false}
                    {...form.getInputProps('consumptionMultiplier')}
                  />
                  <NumberInput
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodeEdit.maxUsers')}
                    description={t('nodeEdit.maxUsersDesc')}
                    min={0}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('maxUsers')}
                  />
                </Box>
              </Stack>

              {/* Egress: three ways out, exactly one of them true at a time. */}
              <Box
                style={{
                  borderRadius: 10,
                  backgroundColor: CARD,
                  border: `1px solid ${HAIRLINE}`,
                  overflow: 'hidden',
                }}
              >
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '20px 20px 16px',
                    width: '100%',
                  }}
                >
                  <GlobeIcon size={14} color={MIST} />
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: '0.14em',
                      lineHeight: '14px',
                      textTransform: 'uppercase',
                      color: MIST,
                    }}
                  >
                    {t('nodeEdit.egressTitle')}
                  </Text>
                  <Box style={{ flex: 1 }} />
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
                    {t('nodeEdit.egressHint')}
                  </Text>
                </Box>

                <EgressRow
                  selected={egress === 'direct'}
                  disabled={egress === 'cascade' || warpMutation.isPending}
                  title={t('nodeEdit.egressDirect')}
                  hint={t('nodeEdit.egressDirectHint')}
                  onClick={() => warpMutation.mutate(false)}
                />
                <EgressRow
                  selected={egress === 'warp'}
                  disabled={egress === 'cascade' || warpMutation.isPending}
                  title={t('nodeEdit.egressWarp')}
                  hint={t('nodeEdit.egressWarpHint')}
                  onClick={() => warpMutation.mutate(true)}
                />
                <EgressRow
                  selected={egress === 'cascade'}
                  disabled
                  title={t('nodeEdit.egressCascade')}
                  hint={cascade ? '' : t('nodeEdit.egressCascadeNone')}
                  trailing={
                    cascade ? (
                      <>
                        <Box
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '5px 10px',
                            borderRadius: 6,
                            backgroundColor: WELL,
                            border: `1px solid ${EDGE}`,
                          }}
                        >
                          <ChainIcon size={12} color={CYAN} />
                          <Text
                            style={{
                              fontFamily: DISPLAY,
                              fontSize: 12,
                              fontWeight: 500,
                              lineHeight: '16px',
                              color: SNOW,
                            }}
                          >
                            {cascade.cascade.name}
                          </Text>
                          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
                            {t(`nodeEdit.role.${cascade.role}`)}
                            {cascade.directions.length > 0
                              ? t('nodeEdit.exitsTo', { where: cascade.directions.join(' · ') })
                              : ''}
                          </Text>
                        </Box>
                        <Box style={{ flex: 1 }} />
                        <UnstyledButton type="button" onClick={() => navigate('/nodes')}>
                          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: CYAN }}>
                            {t('nodeEdit.openCascade')}
                          </Text>
                        </UnstyledButton>
                      </>
                    ) : null
                  }
                />
              </Box>
            </Box>

            {/* System: what the box reports about itself. Read-only. */}
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
              <Stack
                gap={14}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <ChipIcon size={15} color={CYAN} />
                  <Caption>{t('nodeEdit.systemTitle')}</Caption>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  {metrics && (
                    <Box
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 20,
                        paddingInline: 8,
                        borderRadius: 5,
                        backgroundColor: WELL,
                        border: `1px solid ${HAIRLINE}`,
                      }}
                    >
                      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: MIST }}>
                        {t('nodeEdit.uptime', { value: uptime(metrics.uptimeSeconds) })}
                      </Text>
                    </Box>
                  )}
                </Box>

                <Stack gap={10}>
                  <Meter
                    icon={<ChipIcon size={12} color={MOSS} />}
                    label="CPU"
                    detail={
                      metrics?.cpu
                        ? t('nodeEdit.cpuDetail', {
                            cores: metrics.cpu.cores,
                            la: `${metrics.cpu.loadAvg1.toFixed(2)} / ${metrics.cpu.loadAvg5.toFixed(2)} / ${metrics.cpu.loadAvg15.toFixed(2)}`,
                          })
                        : '-'
                    }
                    percent={metrics?.cpu?.usagePercent ?? null}
                  />
                  <Meter
                    icon={<DbIcon size={12} color={MOSS} />}
                    label="RAM"
                    detail={
                      metrics?.memory
                        ? `${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`
                        : '-'
                    }
                    percent={metrics?.memory?.usedPercent ?? null}
                  />
                  <Meter
                    icon={<DiskIcon size={12} color={MOSS} />}
                    label="DISK"
                    detail={
                      metrics?.disk
                        ? `${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}`
                        : '-'
                    }
                    percent={metrics?.disk?.usedPercent ?? null}
                  />
                </Stack>

                <Divider />
                <FactRow label={t('nodeEdit.today')} value={formatBytes(dashNode?.todayBytes ?? 0)} />
                <FactRow label={t('nodeEdit.hosts')} value={String(hostsQuery.data?.hosts.length ?? 0)} />
                <FactRow
                  label={t('nodeEdit.userReach')}
                  value={dashNode ? `~${dashNode.inboundCount}` : '-'}
                />
                <Divider />

                <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1 }}>
                    {t('nodeEdit.exposure')}
                  </Text>
                  <PlainButton
                    icon="shield"
                    strong
                    height={30}
                    disabled={exposureMutation.isPending}
                    onClick={() => exposureMutation.mutate()}
                  >
                    {t('nodeEdit.exposureCheck')}
                  </PlainButton>
                </Box>
                {exposureMutation.data && <ExposureNote result={exposureMutation.data} />}
              </Stack>
            </Box>
          </Box>

          {/* Hosts: the listening ports the agent actually serves here. */}
          <Box
            style={{
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              overflow: 'hidden',
            }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 20, width: '100%' }}>
              <GlobeIcon size={14} color={MIST} />
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.14em',
                  lineHeight: '14px',
                  textTransform: 'uppercase',
                  color: MIST,
                }}
              >
                {t('nodeEdit.hostsTitle')}
              </Text>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
                {t('nodeEdit.hostsHint')}
              </Text>
              <Box style={{ flex: 1 }} />
              <PlainButton icon="plus" strong height={34} edge onClick={() => navigate('/hosts/new')}>
                {t('nodeEdit.attachHost')}
              </PlainButton>
            </Box>

            {(hostsQuery.data?.hosts ?? []).length === 0 ? (
              <Box style={{ padding: '18px 20px', borderTop: `1px solid ${HAIRLINE}` }}>
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: FAINT }}>
                  {t('nodeEdit.hostsEmpty')}
                </Text>
              </Box>
            ) : (
              (hostsQuery.data?.hosts ?? []).map((h) => {
                const binding = bindingById.get(h.bindingId);
                const profile = binding ? profileById.get(binding.profileId) : undefined;
                return (
                  <Box
                    key={h.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 20px',
                      borderTop: `1px solid ${HAIRLINE}`,
                      width: '100%',
                    }}
                  >
                    <Box
                      style={{
                        width: 22,
                        height: 16,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        backgroundColor: h.addressOverride ? WELL : 'transparent',
                        border: h.addressOverride ? `1px solid ${EDGE}` : 'none',
                      }}
                    >
                      {h.addressOverride ? (
                        <LinkIcon size={10} color={FAINT} />
                      ) : (
                        <Text style={{ fontSize: 14, lineHeight: '14px' }}>
                          {countryFlag(node.countryCode ?? '')}
                        </Text>
                      )}
                    </Box>
                    <Text
                      style={{
                        fontFamily: DISPLAY,
                        fontSize: 14,
                        fontWeight: 500,
                        lineHeight: '18px',
                        color: SNOW,
                        width: 180,
                        flexShrink: 0,
                      }}
                    >
                      {h.remark}
                    </Text>
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: '16px',
                        color: CYAN2,
                        width: 70,
                        flexShrink: 0,
                      }}
                    >
                      {h.portOverride ?? binding?.port ?? '-'}
                    </Text>
                    {profile && (
                      <Box
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 10px',
                          borderRadius: 6,
                          backgroundColor: WELL,
                          border: `1px solid ${EDGE}`,
                        }}
                      >
                        <Box
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 999,
                            backgroundColor: PROTOCOL_DOT[profile.protocol] ?? MIST,
                            flexShrink: 0,
                          }}
                        />
                        <Text
                          style={{
                            fontFamily: DISPLAY,
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: '16px',
                            color: SNOW,
                          }}
                        >
                          {profile.name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: MONO,
                            fontSize: 10,
                            letterSpacing: '0.08em',
                            lineHeight: '12px',
                            textTransform: 'uppercase',
                            color: MIST,
                          }}
                        >
                          {shapeOf(profile.protocol, profile.config as Record<string, unknown>)}
                        </Text>
                      </Box>
                    )}
                    <Box style={{ flex: 1 }} />
                    <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Box
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor: h.enabled && node.status === 'online' ? MOSS : DIM,
                        }}
                      />
                      <Text
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          fontWeight: 500,
                          letterSpacing: '0.08em',
                          lineHeight: '14px',
                          textTransform: 'uppercase',
                          color: h.enabled && node.status === 'online' ? MOSS : DIM,
                        }}
                      >
                        {h.enabled ? t('nodeEdit.running') : t('nodeEdit.stopped')}
                      </Text>
                    </Box>
                    <UnstyledButton
                      type="button"
                      onClick={() =>
                        modals.openConfirmModal({
                          title: t('nodeEdit.detachTitle', { name: h.remark }),
                          children: <Text size="sm">{t('nodeEdit.detachBody')}</Text>,
                          labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
                          confirmProps: { color: 'red' },
                          onConfirm: async () => {
                            await deleteHost(h.id);
                            qc.invalidateQueries({ queryKey: ['hosts', id] });
                          },
                        })
                      }
                      style={{ display: 'flex', flexShrink: 0 }}
                    >
                      <TrashIcon size={15} color={FAINT} />
                    </UnstyledButton>
                  </Box>
                );
              })
            )}
          </Box>
        </>
      )}

      {tab === 'routes' && (
        <ResolvedRoutes
          node={node}
          cascade={cascade}
          isBalancerEntry={isBalancerEntry}
          policies={reachablePolicies}
          egressLabel={egress === 'warp' ? t('nodeEdit.egressWarp') : t('nodeEdit.egressDirect')}
        />
      )}
    </Stack>
  );
}

/**
 * What the panel actually assembled for this node, read-only. The rules are
 * evaluated top to bottom by the core, so the list is printed in that order and
 * a rule that a rule above already swallowed is struck out instead of hidden:
 * the operator wrote it, and silently dropping it would look like a panel bug.
 */
function ResolvedRoutes({
  node,
  cascade,
  isBalancerEntry,
  policies,
  egressLabel,
}: {
  node: Node;
  cascade: { cascade: Cascade; role: string; directions: string[] } | null;
  isBalancerEntry: boolean;
  policies: { policy: RoutePolicy; squads: string[] }[];
  egressLabel: string;
}) {
  const { t } = useTranslation();
  // Tag 0 is the plain profile every user gets; the rest are granted policies.
  const [tag, setTag] = useState(0);

  // Only a node outside every cascade has nothing: each hop carries a rule set,
  // it is just a short one everywhere except the balancer entry.
  if (!cascade) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Stack align="center" gap={8}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>
            {t('nodeEdit.routes.noneTitle')}
          </Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, maxWidth: 560, textAlign: 'center' }}>
            {t('nodeEdit.routes.noneBody', { egress: egressLabel })}
          </Text>
        </Stack>
      </Box>
    );
  }

  const exits = cascade.cascade.hops.slice(1);

  // Transit and exit hops answer one question only: what arrives on the
  // inter-hop link goes where. No tags, no policies, so the header and the two
  // rows are the whole truth about them.
  if (!isBalancerEntry && cascade.role !== 'entry') {
    return (
      <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
        <RoutesHeader node={node} role={cascade.role} />
        <TableHead />
        <RuleRow
          accent={MOSS}
          background={WELL}
          icon={<ChainIcon size={13} color={FAINT} />}
          match={t('nodeEdit.routes.fromLink')}
          action={
            cascade.role === 'exit'
              ? t('nodeEdit.routes.fromOurIp')
              : t('nodeEdit.routes.toDirection', {
                  where: cascade.directions.length > 0 ? cascade.directions.join(' · ') : '-',
                })
          }
          actionDot={cascade.role === 'exit' ? MOSS : VIOLET}
          why={t(`nodeEdit.routes.why.${cascade.role}`, { cascade: cascade.cascade.name })}
        />
        <RuleRow
          accent={DIM}
          icon={<CircleMinusIcon size={14} color={FAINT} />}
          match={t('nodeEdit.routes.everythingElse')}
          matchStrong
          action={t('nodeEdit.routes.nothingElse')}
          why={t('nodeEdit.routes.nothingElseWhy')}
          muted
        />
      </Box>
    );
  }

  // A chain entry has no route profiles: one path, so no tag to pick.
  if (!isBalancerEntry) {
    return (
      <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
        <RoutesHeader node={node} role="entry" />
        <TableHead />
        <RuleRow
          accent={RED}
          background={WELL}
          icon={<LockIcon size={13} color={FAINT} />}
          match={t('nodeEdit.routes.quicMatch')}
          action={t('nodeEdit.routes.quicAction')}
          why={t('nodeEdit.routes.quicWhy')}
          muted
        />
        <RuleRow
          accent={MOSS}
          background={WELL}
          icon={<CircleMinusIcon size={14} color={FAINT} />}
          match={t('nodeEdit.routes.everythingElse')}
          matchStrong
          action={t('nodeEdit.routes.toDirection', {
                  where: cascade.directions.length > 0 ? cascade.directions.join(' · ') : '-',
                })}
          actionDot={VIOLET}
          why={t('nodeEdit.routes.why.chainEntry', { cascade: cascade.cascade.name })}
        />
      </Box>
    );
  }

  const active = policies.find((p) => p.policy.ordinal === tag) ?? null;
  // Block is emitted above direct, so a domain in both never reaches direct.
  const blocked = new Set(active?.policy.blockDomains ?? []);
  const deadDirect = (active?.policy.directDomains ?? []).filter((d) => blocked.has(d));
  const liveDirect = (active?.policy.directDomains ?? []).filter((d) => !blocked.has(d));
  const source = active ? t('nodeEdit.routes.source', { policy: active.policy.name, squads: active.squads.join(', ') }) : '';

  return (
    <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
      <RoutesHeader node={node} role="entry" balancer />

      {/* One node carries every set; the tag in the client's UUID picks one. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 20px',
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.12em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: FAINT,
            flexShrink: 0,
          }}
        >
          {t('nodeEdit.routes.showFor')}
        </Text>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TagButton active={tag === 0} onClick={() => setTag(0)} label={t('nodeEdit.routes.plain')} tag={0} />
          {policies.map(({ policy }) => (
            <TagButton
              key={policy.id}
              active={tag === policy.ordinal}
              onClick={() => setTag(policy.ordinal)}
              label={policy.name}
              tag={policy.ordinal}
            />
          ))}
        </Box>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
          {t('nodeEdit.routes.switchHint')}
        </Text>
      </Box>

      <TableHead />

      {/* Always first, on every tag: the panel's own guard rule. */}
      <RuleRow
        accent={RED}
        background={WELL}
        icon={<LockIcon size={13} color={FAINT} />}
        match={t('nodeEdit.routes.quicMatch')}
        action={t('nodeEdit.routes.quicAction')}
        why={t('nodeEdit.routes.quicWhy')}
        muted
      />

      {active && active.policy.blockDomains.length > 0 && (
        <RuleRow
          accent={CYAN}
          match={active.policy.blockDomains.join(' · ')}
          action={t('nodeEdit.routes.toNowhere')}
          actionDot={RED}
          why={source}
        />
      )}
      {active && liveDirect.length > 0 && (
        <RuleRow
          accent={CYAN}
          match={liveDirect.join(' · ')}
          action={t('nodeEdit.routes.fromOurIp')}
          actionDot={MOSS}
          why={source}
        />
      )}
      {deadDirect.length > 0 && (
        <RuleRow
          accent={AMBER}
          background={`${AMBER}0D`}
          icon={<WarnIcon size={14} color={AMBER} />}
          match={deadDirect.join(' · ')}
          action={t('nodeEdit.routes.fromOurIp')}
          why={t('nodeEdit.routes.deadWhy')}
          whyTone={AMBER}
          struck
        />
      )}

      {/* The catch-all. Which exit it lands on is the node's own door. */}
      <RuleRow
        accent={MOSS}
        background={WELL}
        icon={<CircleMinusIcon size={14} color={FAINT} />}
        match={t('nodeEdit.routes.everythingElse')}
        matchStrong
        why={t('nodeEdit.routes.defaultWhy')}
        actionBox={
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              height: 34,
              paddingInline: 12,
              borderRadius: 8,
              backgroundColor: CARD,
              border: `1px solid ${EDGE}`,
              width: 250,
              flexShrink: 0,
            }}
          >
            <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: VIOLET, flexShrink: 0 }} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
              {exits.length === 1
                ? t('nodeEdit.routes.exitOne', { name: exits[0]!.nodeName })
                : t('nodeEdit.routes.exitMany', { count: exits.length })}
            </Text>
          </Box>
        }
      />
    </Box>
  );
}

/** Name of the node plus the role it plays in its cascade. */
function RoutesHeader({
  node,
  role,
  balancer,
}: {
  node: Node;
  role: string;
  balancer?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '18px 20px',
        backgroundColor: WELL,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, lineHeight: '20px', color: SNOW }}>
        {node.name}
      </Text>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: 6,
          backgroundColor: `${VIOLET}1A`,
          border: `1px solid ${VIOLET}`,
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: VIOLET,
          }}
        >
          {balancer ? t('nodeEdit.routes.entryChip') : t(`nodeEdit.routes.chip.${role}`)}
        </Text>
      </Box>
      <Box style={{ flex: 1 }} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
        {t('nodeEdit.routes.readOnly')}
      </Text>
    </Box>
  );
}

function TableHead() {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 20px',
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ width: 26, flexShrink: 0 }} />
      <ColHead style={{ flex: 1, minWidth: 0 }}>{t('nodeEdit.routes.colIf')}</ColHead>
      <ColHead style={{ width: 250, flexShrink: 0 }}>{t('nodeEdit.routes.colThen')}</ColHead>
      <ColHead style={{ width: 430, flexShrink: 0 }}>{t('nodeEdit.routes.colWhy')}</ColHead>
    </Box>
  );
}

function ColHead({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: FAINT,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

function TagButton({
  active,
  label,
  tag,
  onClick,
}: {
  active: boolean;
  label: string;
  tag: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        paddingInline: 12,
        borderRadius: 8,
        backgroundColor: active ? `${CYAN}1A` : WELL,
        border: `1px solid ${active ? CYAN : HAIRLINE}`,
      }}
    >
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: active ? CYAN : FAINT }}>
        {t('nodeEdit.routes.tag', { tag })}
      </Text>
    </UnstyledButton>
  );
}

/** One line of the resolved stack. The left edge says what kind of line it is. */
function RuleRow({
  accent,
  background,
  icon,
  match,
  matchStrong,
  struck,
  muted,
  action,
  actionDot,
  actionBox,
  why,
  whyTone,
}: {
  accent: string;
  background?: string;
  icon?: React.ReactNode;
  match: string;
  matchStrong?: boolean;
  struck?: boolean;
  muted?: boolean;
  action?: string;
  actionDot?: string;
  actionBox?: React.ReactNode;
  why: string;
  whyTone?: string;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 20px',
        borderTop: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        backgroundColor: background ?? 'transparent',
        width: '100%',
      }}
    >
      <Box
        style={{
          width: 23,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </Box>
      <Text
        style={{
          fontFamily: matchStrong ? DISPLAY : MONO,
          fontSize: 13,
          fontWeight: matchStrong ? 500 : 400,
          lineHeight: '16px',
          color: struck || muted ? (struck ? FAINT : MIST) : SNOW,
          textDecoration: struck ? 'line-through' : undefined,
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {match}
      </Text>
      {actionBox ?? (
        <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: 250, flexShrink: 0 }}>
          {actionDot && (
            <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: actionDot, flexShrink: 0 }} />
          )}
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 13,
              lineHeight: '16px',
              color: struck || muted ? MIST : SNOW,
            }}
          >
            {action}
          </Text>
        </Box>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 12,
          lineHeight: '16px',
          color: whyTone ?? FAINT,
          width: 430,
          flexShrink: 0,
        }}
      >
        {why}
      </Text>
    </Box>
  );
}

function LockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

function CircleMinusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M8 12h8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Each protocol keeps one accent across every screen it appears on. */
const PROTOCOL_DOT: Record<string, string> = {
  xray: VIOLET,
  shadowsocks: '#F5A3B8',
  hysteria: CYAN,
  amneziawg: MOSS,
  naive: AMBER,
  mtproto: CYAN2,
  mieru: '#C78BFA',
  tuic: CYAN,
  anytls: MIST,
  shadowtls: MIST,
};

/** The wire shape of a profile, in the shorthand the host rows use. */
function shapeOf(protocol: string, cfg: Record<string, unknown>): string {
  if (protocol !== 'xray') return protocol;
  const sub = String(cfg['subprotocol'] ?? 'vless');
  const net = String(cfg['network'] ?? 'raw');
  const sec = String(cfg['security'] ?? 'reality');
  return `${sub} ${net === 'raw' ? 'tcp' : net} ${sec}`;
}

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${String(h).padStart(2, '0')}h` : `${h}h`;
}

function Sep() {
  return <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>;
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

function Divider() {
  return <Box style={{ height: 1, width: '100%', backgroundColor: HAIRLINE }} />;
}

function DotChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        paddingInline: 8,
        borderRadius: 6,
        backgroundColor: `${color}14`,
        border: `1px solid ${color}2E`,
        flexShrink: 0,
      }}
    >
      <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, lineHeight: '15px', color: SNOW }}>
        {value}
      </Text>
    </Box>
  );
}

/** A 3px bar with its own caption line. Grey when the agent reported nothing. */
function Meter({
  icon,
  label,
  detail,
  percent,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  percent: number | null;
}) {
  const tone = percent === null ? DIM : percent >= 90 ? RED : percent >= 70 ? AMBER : MOSS;
  return (
    <Stack gap={4}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        {icon}
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            color: MIST,
          }}
        >
          {label}
        </Text>
        <Text
          style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT, flex: 1, minWidth: 0 }}
        >
          {detail}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, lineHeight: '13px', color: SNOW }}>
          {percent === null ? '-' : `${Math.round(percent)}%`}
        </Text>
      </Box>
      <Box style={{ height: 3, width: '100%', borderRadius: 999, backgroundColor: HAIRLINE }}>
        <Box
          style={{
            height: 3,
            borderRadius: 999,
            backgroundColor: tone,
            width: `${Math.min(100, Math.max(0, percent ?? 0))}%`,
          }}
        />
      </Box>
    </Stack>
  );
}

function ExposureNote({
  result,
}: {
  result: { checked: boolean; unexpectedPorts?: number[]; note?: string };
}) {
  const { t } = useTranslation();
  const clean = result.checked && (result.unexpectedPorts ?? []).length === 0;
  const tone = !result.checked ? MIST : clean ? MOSS : AMBER;
  const text = !result.checked
    ? t('nodes.form.exposureSkipped', { note: result.note ?? '-' })
    : clean
      ? t('nodes.form.exposureClean')
      : t('nodes.form.exposureExtra', { ports: (result.unexpectedPorts ?? []).join(', ') });
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 12px',
        borderRadius: 8,
        backgroundColor: `${tone}0F`,
        border: `1px solid ${tone}2E`,
        width: '100%',
      }}
    >
      {clean ? <TickIcon size={13} color={tone} /> : <WarnIcon size={13} color={tone} />}
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: tone, flex: 1 }}>{text}</Text>
    </Box>
  );
}

/** One way out of the node. The selected row lifts on a faint cyan wash. */
function EgressRow({
  selected,
  disabled,
  title,
  hint,
  trailing,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  hint: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        borderTop: `1px solid ${HAIRLINE}`,
        backgroundColor: selected ? `${CYAN}0F` : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        width: '100%',
      }}
    >
      <Box
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          border: `1px solid ${selected ? CYAN : DIM}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {selected && <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: CYAN }} />}
      </Box>
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: selected ? SNOW : MIST,
          width: 190,
          flexShrink: 0,
        }}
      >
        {title}
      </Text>
      {trailing ?? (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1 }}>
          {hint}
        </Text>
      )}
    </Box>
  );
}

function TabButton({
  children,
  active,
  icon,
  badge,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  icon: 'server' | 'route';
  badge?: number;
  onClick: () => void;
}) {
  const stroke = active ? CYAN : MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: active ? `${CYAN}1A` : WELL,
        border: `1px solid ${active ? CYAN : HAIRLINE}`,
      }}
    >
      {icon === 'server' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={stroke} strokeWidth="1.6" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <circle cx="5" cy="6" r="2.2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <circle cx="19" cy="18" r="2.2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <path
            d="M5 8.5v4a3 3 0 0 0 3 3h8.8"
            fill="none"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M9 6h9" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
      {badge !== undefined && badge > 0 && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 18,
            paddingInline: 6,
            borderRadius: 5,
            backgroundColor: `${AMBER}24`,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: AMBER }}>{badge}</Text>
        </Box>
      )}
    </UnstyledButton>
  );
}

function PlainButton({
  children,
  icon,
  strong,
  edge,
  height = 38,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  icon?: 'key' | 'tick' | 'shield' | 'plus';
  strong?: boolean;
  edge?: boolean;
  height?: number;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height,
        paddingInline: height >= 38 ? 16 : 14,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${edge ? EDGE : HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon === 'key' && <KeyIcon size={14} color={CYAN} />}
      {icon === 'tick' && <TickIcon size={14} color={CYAN} />}
      {icon === 'shield' && <ShieldIcon size={13} color={CYAN} />}
      {icon === 'plus' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 5v14M5 12h14" fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: height >= 34 ? 13 : 12,
          fontWeight: 500,
          lineHeight: '16px',
          color: strong ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}

function ServerIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.7" />
      <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M7 8h.01" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7 17h.01" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M3 12h18" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0 -18"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChipIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="5" y="5" width="14" height="14" rx="1" fill="none" stroke={color} strokeWidth="1.6" />
      <rect x="9" y="9" width="6" height="6" fill="none" stroke={color} strokeWidth="1.6" />
      <path
        d="M3 10h2M3 14h2M19 10h2M19 14h2M10 3v2M14 3v2M10 19v2M14 19v2"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DbIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <ellipse cx="12" cy="6" rx="8" ry="3" fill="none" stroke={color} strokeWidth="1.6" />
      <path
        d="M4 6v6c0 1.7 3.6 3 8 3s8 -1.3 8 -3V6"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M4 12v6c0 1.7 3.6 3 8 3s8 -1.3 8 -3v-6"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DiskIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="2" fill="none" stroke={color} strokeWidth="1.6" />
      <path d="M14 4v4h-6v-4" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ChainIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="5.5" cy="18.5" r="2.5" fill="none" stroke={color} strokeWidth="2" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="none" stroke={color} strokeWidth="2" />
      <path
        d="M5.5 16v-0.5a3.5 3.5 0 0 1 3.5 -3.5h6a3.5 3.5 0 0 0 3.5 -3.5v-0.5"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LinkIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M9 15l6-6M10.5 6.5l1.5-1.5a4.24 4.24 0 0 1 6 6l-1.5 1.5M7.5 12.5l-1.5 1.5a4.24 4.24 0 0 0 6 6l1.5-1.5"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KeyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="15" r="4" fill="none" stroke={color} strokeWidth="2" />
      <path d="M10.85 12.15L19 4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M18 5l2 2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M15 8l2 2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M10.3 4.3l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7 -3l-8 -14a2 2 0 0 0 -3.4 0"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M4 7h16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M10 11v6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M14 11v6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2l1 -12"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7v-2a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v2"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
