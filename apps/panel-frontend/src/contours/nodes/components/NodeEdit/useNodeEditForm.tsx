import { useEffect, useMemo, useState } from 'react';
import { syncPoll } from '@/contours/nodes/lib/syncPoll';
import { apiErrorMessage } from '@/lib/net/client';
import { onBootstrapIssued, type BootstrapInfo } from '@/contours/nodes/lib/bootstrapIssued';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableNodeWarp,
  findNode,
  getNodeExposure,
  getNodeSyncStatus,
  listAllNodes,
  listRegions,
  refreshNodeBootstrap,
  registerNodeWarp,
  rotateNodeCert,
  updateNode,
} from '@/lib/domain/nodes';
import { certRotateRefusal } from '@/contours/nodes/lib/nodeCert';
import { maxUsersPatch, multiplierFieldError, multiplierPatch, parseMaxUsers } from '@/contours/nodes/lib/nodeLimits';
import type { Node } from '@/lib/domain/nodes';
import { listBindings, listProfiles } from '@/lib/domain/profiles';
import { listCascades, type Cascade } from '@/lib/domain/cascades';
import { cascadeExitWords, cascadeMemberships, type CascadeRole } from '@/lib/domain/cascadeMembership';
import { listHosts } from '@/lib/domain/hosts';
import { listRoutePolicies, type RoutePolicy } from '@/lib/domain/routePolicies';
// Aliased: the state below holds the refusal and wants the plain name. An
// import and a local under one name resolve to the local and fail far from
// here, which is the same trap a shadowed `Text` or `Node` sets.
import { listNodePolicies, policyFitRefusal as readPolicyRefusal } from '@/lib/domain/nodePolicies';
import { listSquads } from '@/lib/domain/squads';
import { useOverview } from '@/lib/domain/dashboard';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { defaults, domainOk, domainPatch, egressOf, nodeEnginesPut, type FormValues } from '@/contours/nodes/lib/nodeEditForm';
import { loadFailure, loadView } from '@/lib/ui/loadView';
import { nodeEnginesRefusal, type NodeEnginesRefusal } from '@/contours/nodes/lib/nodeCreateForm';
import { AMBER, DIM, MOSS } from '@/contours/nodes/lib/colors';
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols';
import { coreVersionRefusal, coreVersionsPatch } from '@/lib/domain/coreVersions';
export function useNodeEditForm() {
  const { t, i18n } = useTranslation();
  // The multiplier is shown with the language's decimal mark (A-143).
  const comma = i18n.language.startsWith('ru');

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
  const fleetQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listAllNodes() });
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
  // Э3 layer B: the policies this node could be given, and whether the config
  // it should be running has actually landed on the machine.
  const nodePoliciesQuery = useQuery({ queryKey: ['node-policies'], queryFn: listNodePolicies });
  const syncQuery = useQuery({
    queryKey: ['node-sync', id],
    queryFn: () => getNodeSyncStatus(id!),
    enabled: !!id,
    // A push is asynchronous and lands seconds later; without this the card
    // says "not applied yet" until the operator reloads the page themselves.
    // How often, and when to stop, is syncPoll's: 5 s while a push is pending,
    // none after it times out.
    refetchInterval: (q) => syncPoll(q.state.data, Date.now()).intervalMs,
  });
  // The drawing the agent reports is read once; when the config lands, it is
  // read again, or the policy lines keep the answer from before the save.
  const applied = syncQuery.data?.applied;
  useEffect(() => {
    if (applied) void qc.invalidateQueries({ queryKey: ['policy-drawing', id] });
  }, [applied, qc, id]);
  const [policyRefusal, setPolicyRefusal] = useState<string | null>(null);
  const overviewQuery = useOverview();

  const form = useForm<FormValues>({
    initialValues: defaults(node, comma),
    validateInputOnBlur: true,
    validate: {
      // A-143: refused at the field, never rounded.
      // Empty on an edit is refused, not 1: it would make a free node paid.
      consumptionMultiplier: (v) => {
        const e = multiplierFieldError(v, true);
        return e === 'required' ? t('nodeEdit.multiplierRequired') : e === 'bad' ? t('nodeEdit.multiplierBad') : null;
      },
      maxUsers: (v) => (parseMaxUsers(v).ok ? null : t('nodeEdit.maxUsersDesc')),
      domain: (v) => (domainOk(v) ? null : t('nodeEdit.domainBad')),
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
    form.setValues(defaults(node, comma));
    form.resetDirty(defaults(node, comma));
    setSeeded(true);
  }

  usePageMeta([node?.name ?? '']);

  const dashNode = overviewQuery.data?.nodes.find((n) => n.id === id);
  const metrics = dashNode?.metrics ?? null;

  // A node sits in at most one cascade; the hop's position names its role.
  //
  // Тело вынесено в чистую функцию рядом с файлом: с циклом, `continue` и
  // выходом из середины компилятор React не может доказать, что сохранит
  // ручную мемоизацию, и отказывается оптимизировать хук целиком. Вызов одной
  // функции он разбирает без труда, а читается это место так же.
  const cascade = useMemo(
    () => cascadeOfNode(cascadesQuery.data?.cascades ?? [], fleetQuery.data?.nodes ?? [], id ?? ''),
    [cascadesQuery.data, fleetQuery.data, id],
  );

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

  // Что из версий ядер оператор поменял против сохранённого. undefined, если
  // ничего или если сервер поля не знает.
  const coreVersionsDiff = coreVersionsPatch(node?.coreVersions, form.values.coreVersions);
  const [coreRefusal, setCoreRefusal] = useState<string[] | null>(null);
  // Ядра ноды на этой странице только показываются (E42): в PUT не уходят.
  const enginesKnown = node?.intendedEngines !== undefined;
  const enginesBody = nodeEnginesPut(enginesKnown, form.values.protocol);
  /** Отказ 400 INVALID_ENGINES или LAST_CORE: под чипами. */
  const [enginesRefusal, setEnginesRefusal] = useState<NodeEnginesRefusal | null>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const port = form.values.port === '' ? DEFAULT_NODE_PORT : Number(form.values.port);
      return updateNode(id!, {
        name: form.values.name.trim(),
        address: `${form.values.host.trim()}:${port}`,
        countryCode: form.values.countryCode || null,
        regionId: form.values.regionId || null,
        // A-057: only when changed, the server re-pushes the node on a new one.
        ...domainPatch(node?.domain, form.values.domain),
        // Validated before the save is offered; a value that does not parse here is not sent.
        ...multiplierPatch(form.values.consumptionMultiplier, true),
        ...maxUsersPatch(form.values.maxUsers),
        policyId: form.values.policyId || null,
        // Поколения AWG нет: это факт модуля, не выбор (227054e).
        // Версии ядер: только изменённые компоненты, и только если сервер поле
        // знает (ключ пришёл в ответе про ноду).
        ...(coreVersionsDiff ? { coreVersions: coreVersionsDiff } : {}),
        // Метка: у сервера старше поля прежний `protocol` из селекта; у
        // сервера с полем ни ядер, ни метки (nodeEnginesPut, E42).
        ...enginesBody,
      });
    },
    onSuccess: () => {
      setPolicyRefusal(null);
      setCoreRefusal(null);
      setEnginesRefusal(null);
      qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['node', id] });
      qc.invalidateQueries({ queryKey: ['node-policies'] });
      qc.invalidateQueries({ queryKey: ['node-sync', id] });
      // A-232: the drawing lines read the saved policy.
      qc.invalidateQueries({ queryKey: ['policy-drawing', id] });
      form.resetDirty(form.values);
      notifications.show({ color: 'green', message: t('nodeEdit.saved') });
    },
    onError: (err) => {
      // A policy this machine cannot carry out comes back naming the node and
      // the reason. That sentence is the answer; a toast saying "save failed"
      // would throw away the only part that tells the operator what to fix, so
      // it stays on the screen next to the picker that caused it. Only that
      // refusal: every other error has its own place.
      const refusal = readPolicyRefusal(err);
      setPolicyRefusal(refusal ? refusal.message : null);
      // Версия, которой нет в манифесте: сервер называет каждый компонент.
      // Строки встают в секции «Ядра», рядом с выбором, который их вызвал.
      const coreLines = coreVersionRefusal(err);
      setCoreRefusal(coreLines);
      // Отказ по ядрам (INVALID_ENGINES, LAST_CORE): фраза сервера с кодом и
      // полем под чипами. Чипов нет (сервер старше поля): тем же тостом.
      const enginesBad = nodeEnginesRefusal(err);
      setEnginesRefusal(enginesBad);
      if (enginesBad && !enginesKnown) {
        notifications.show({ color: 'red', title: t('common.saveError'), message: t('nodes.form.enginesRefusedToast', { ...enginesBad }) });
        return;
      }
      if (refusal || coreLines || enginesBad) return;
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: apiErrorMessage(err),
      });
    },
  });

  const warpMutation = useMutation({
    mutationFn: (on: boolean) => (on ? registerNodeWarp(id!) : disableNodeWarp(id!)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nodes'] }),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('nodeEdit.warpError'),
        message: apiErrorMessage(err),
      }),
  });

  const exposureMutation = useMutation({
    mutationFn: () => getNodeExposure(id!),
  });

  // A-124: a refusal the server names is said under the certificate row
  // (certRotateRefusal); anything else is a toast in the server's words.
  const certMutation = useMutation({
    mutationFn: () => rotateNodeCert(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['node', id] });
      void qc.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: (err) => {
      if (certRotateRefusal(err)) return;
      notifications.show({ color: 'red', title: t('common.error'), message: apiErrorMessage(err) });
    },
  });

  /** The command of a re-issued token, shown until the operator closes it (A-147). */
  const [issuedBootstrap, setIssuedBootstrap] = useState<BootstrapInfo | null>(null);
  const bootstrapMutation = useMutation({
    mutationFn: () => refreshNodeBootstrap(id!),
    onSuccess: (info) =>
      onBootstrapIssued(info, setIssuedBootstrap, (n) => notifications.show({ color: 'green', ...n }), t),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.error'),
        message: apiErrorMessage(err),
      }),
  });

  const statusTone = node?.status === 'online' ? MOSS : node?.status === 'offline' ? DIM : AMBER;
  const warpOn = node?.warpEnabled ?? false;
  // Whether the node is in a cascade is known only from the cascade list; a
  // missing list is said, not read as «straight out» (spec frontend-nodes).
  const cascadeFailure = loadFailure(cascadesQuery, apiErrorMessage);
  const egress = egressOf(cascade !== null, loadView(cascadesQuery) === 'ready', warpOn);
  // Lists a side of the page reads; each failure is said where the list feeds.
  const syncFailure = loadFailure(syncQuery, apiErrorMessage);
  const regionsFailure = loadFailure(regionsQuery, apiErrorMessage);
  const nodePoliciesFailure = loadFailure(nodePoliciesQuery, apiErrorMessage);
  // The reachable policies come from three lists; any one missing makes the
  // empty answer a guess.
  const reachFailure = isBalancerEntry
    ? ([bindingsQuery, squadsQuery, policiesQuery].map((q) => loadFailure(q, apiErrorMessage)).find((f) => f !== null) ?? null)
    : null;

  return {
    issuedBootstrap,
    setIssuedBootstrap,
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
    nodePoliciesQuery,
    syncQuery,
    policyRefusal,
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
    coreRefusal,
    enginesKnown,
    enginesRefusal,
    setEnginesRefusal,
    warpMutation,
    exposureMutation,
    certMutation,
    bootstrapMutation,
    statusTone,
    warpOn,
    egress,
    cascadeFailure,
    syncFailure,
    regionsFailure,
    nodePoliciesFailure,
    reachFailure,
  };
}

/** Everything the edit screen hands to its sections. */
export type NodeEditor = ReturnType<typeof useNodeEditForm>;

/**
 * Каскад, в котором стоит эта нода, с её ролью и списком направлений.
 *
 * `null`, когда нода не в каскаде. Членство по позициям и направлениям v4,
 * хопы только у старых каскадов (cascadeMemberships, A-144): по одним хопам
 * нода v4-каскада выходила одиночной, и экран писал «напрямую».
 */
function cascadeOfNode(
  cascades: Cascade[],
  fleet: Node[],
  id: string,
): { cascade: Cascade; role: CascadeRole; directions: string[] } | null {
  const m = cascadeMemberships(cascades).get(id);
  if (!m) return null;
  // What this node feeds is a set of DIRECTIONS, named by the country a
  // client picks, not the next machine in a list. The node under a direction
  // can be swapped without any of this changing.
  const directions = cascadeExitWords(m.cascade, (nodeId) => fleet.find((n) => n.id === nodeId)?.countryCode);
  return { cascade: m.cascade, role: m.role, directions: m.role === 'exit' ? [] : directions };
}
