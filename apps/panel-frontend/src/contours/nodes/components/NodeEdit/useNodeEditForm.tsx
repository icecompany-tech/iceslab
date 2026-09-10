import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableNodeWarp,
  findNode,
  getNodeExposure,
  listNodes,
  listRegions,
  refreshNodeBootstrap,
  registerNodeWarp,
  updateNode,
} from '@/lib/domain/nodes';
import { listBindings, listProfiles } from '@/lib/domain/profiles';
import { listCascades } from '@/lib/domain/cascades';
import { listHosts } from '@/lib/domain/hosts';
import { listRoutePolicies, type RoutePolicy } from '@/lib/domain/routePolicies';
import { listSquads } from '@/lib/domain/squads';
import { useOverview } from '@/lib/domain/dashboard';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { defaults, type FormValues } from '@/contours/nodes/lib/nodeEditForm';
import { AMBER, DIM, MOSS } from '@/contours/nodes/lib/colors';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
export function useNodeEditForm() {
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

  const statusTone = node?.status === 'online' ? MOSS : node?.status === 'offline' ? DIM : AMBER;
  const warpOn = node?.warpEnabled ?? false;
  const egress: 'direct' | 'warp' | 'cascade' = cascade ? 'cascade' : warpOn ? 'warp' : 'direct';

  return {
    tab,
    setTab,
    id,
    navigate,
    qc,
    nodesQuery,
    node,
    regionsQuery,
    cascadesQuery,
    fleetQuery,
    bindingsQuery,
    hostsQuery,
    profilesQuery,
    squadsQuery,
    policiesQuery,
    overviewQuery,
    form,
    dashNode,
    metrics,
    cascade,
    isBalancerEntry,
    reachablePolicies,
    profileById,
    bindingById,
    saveMutation,
    warpMutation,
    exposureMutation,
    bootstrapMutation,
    statusTone,
    warpOn,
    egress,
  };
}

/** Everything the edit screen hands to its sections. */
export type NodeEditor = ReturnType<typeof useNodeEditForm>;
