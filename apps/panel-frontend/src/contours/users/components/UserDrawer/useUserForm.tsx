import type { CreateUserInput, UpdateUserInput } from '@/lib/domain/users';
import type { FormValues } from '@/contours/users/lib/userForm';
import type { Preset } from '@/contours/users/lib/userPresets';
import type { PreviewData, PreviewRowData } from '@/contours/users/components/UserDrawer/PreviewCard';
import { ALL_SQUAD_ID } from '@/lib/domain/routePolicies';
import { defaultValues } from '@/contours/users/lib/userForm';
import { fetchUserEndpoints, listUsers } from '@/lib/domain/users';
import { listBindings, listProfiles } from '@/lib/domain/profiles';
import { listNodes } from '@/lib/domain/nodes';
import { listSquads } from '@/lib/domain/squads';
import { loadPresets } from '@/contours/users/lib/userPresets';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Props } from '@/contours/users/components/UserDrawer';

/**
 * The draft a user is edited as: the form, the lists it picks from (squads,
 * profiles, nodes), the name check, the traffic estimate and the preview of
 * what the subscription will hand out. The drawer keeps layout only.
 */
export function useUserForm({ opened, user, onSubmit, onClose }: Props) {
  const { t } = useTranslation();

  const isEdit = user !== null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const presets = useMemo(() => loadPresets(), [opened]);

  const form = useForm<FormValues>({
    initialValues: defaultValues(user),
    validate: {
      username: (v) => {
        if (isEdit) return null;
        if (v.length < 3) return t('validation.nameMin3');
        if (!/^[a-zA-Z0-9_-]+$/.test(v)) return t('validation.usernameLatinOnly');
        return null;
      },
      email: (v) =>
        v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? t('validation.emailInvalid') : null,
    },
  });

  useEffect(() => {
    if (opened) {
      form.setValues(defaultValues(user));
      setAdvancedOpen(false);
      setPresetId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, user?.id, user?.updatedAt]);

  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads, enabled: opened });
  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: opened,
  });
  const bindingsQuery = useQuery({
    queryKey: ['bindings'],
    queryFn: () => listBindings(),
    enabled: opened,
  });
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes(), enabled: opened });

  const squads = squadsQuery.data?.squads ?? [];

  // Username availability. There is no dedicated endpoint, so this reuses the
  // list search and compares exactly: a substring hit on another user must not
  // read as "taken". Only meaningful while creating.
  const nameProbe = form.values.username.trim();
  const nameQuery = useQuery({
    queryKey: ['username-probe', nameProbe],
    queryFn: () => listUsers({ search: nameProbe, limit: 10 }),
    enabled: opened && !isEdit && nameProbe.length >= 3,
    staleTime: 30_000,
  });
  const nameTaken =
    nameQuery.data?.users.some((u) => u.username.toLowerCase() === nameProbe.toLowerCase()) ?? false;
  const nameFree = !isEdit && nameProbe.length >= 3 && !nameQuery.isFetching && !nameTaken;

  /**
   * The real answer for a user who already exists: the endpoints endpoint runs
   * generateSubscription, the very pipeline behind /sub, so what shows here is
   * what will leave, by construction.
   *
   * This used to be recomputed in the browser from bindings, one row each, and
   * it drifted. That version knew nothing about hidden cascade exits, about an
   * entry fanning out into one config per direction and policy, about hosts
   * (a binding can have several or none), about a host being disabled, about a
   * squad narrowing hosts, or about disableForFormats. It reported "4 configs ·
   * 4 nodes" and named two nodes the client never receives directly.
   */
  const endpointsQuery = useQuery({
    queryKey: ['user-endpoints', user?.id],
    queryFn: () => fetchUserEndpoints(user!.id),
    enabled: opened && isEdit,
    staleTime: 30_000,
  });

  /**
   * The estimate for a user who does not exist yet. No id means nothing to ask
   * the server about, so squads to profiles to bindings is the best guess
   * available, and the block says so instead of presenting it as fact.
   */
  const estimate = useMemo(() => {
    const picked = form.values.groupIds.length > 0 ? form.values.groupIds : [ALL_SQUAD_ID];
    const profileIds = new Set<string>();
    for (const s of squads) {
      if (picked.includes(s.id)) for (const pid of s.profileIds) profileIds.add(pid);
    }
    const profileById = new Map((profilesQuery.data?.profiles ?? []).map((p) => [p.id, p]));
    const nodeById = new Map((nodesQuery.data?.nodes ?? []).map((n) => [n.id, n]));

    const rows: PreviewRowData[] = [];
    const nodeIds = new Set<string>();
    const protocols = new Set<string>();

    for (const b of bindingsQuery.data?.bindings ?? []) {
      if (!profileIds.has(b.profileId) || !b.enabled) continue;
      const node = nodeById.get(b.nodeId);
      const profile = profileById.get(b.profileId);
      if (!node || !profile) continue;
      nodeIds.add(node.id);
      protocols.add(profile.protocol);
      rows.push({
        key: b.id,
        title: node.name,
        protocol: profile.protocol,
        note: node.countryCode ? node.countryCode.toUpperCase() : null,
        online: node.status === 'online',
      });
    }

    return {
      rows,
      configs: rows.length,
      places: nodeIds.size,
      protocols: protocols.size,
      online: rows.filter((r) => r.online).length,
      estimate: true as const,
    };
  }, [form.values.groupIds, squads, profilesQuery.data, bindingsQuery.data, nodesQuery.data]);

  const preview: PreviewData = useMemo(() => {
    if (!isEdit) return estimate;
    const endpoints = endpointsQuery.data?.endpoints ?? [];
    // Joined by node id, never by name: one node hands out several lines under
    // different labels, so matching on the caption would match nothing at all.
    const nodeById = new Map((nodesQuery.data?.nodes ?? []).map((n) => [n.id, n]));
    const rows = endpoints.map((e, i) => ({
      key: `${e.uri.slice(0, 40)}#${i}`,
      // The caption the client will show, which is what an operator gets asked
      // about over support chat.
      title: e.label,
      protocol: e.protocol,
      note: String(e.port),
      online: nodeById.get(e.nodeId)?.status === 'online',
    }));
    return {
      rows,
      configs: rows.length,
      // Real nodes again, now that there is an id to count. Two endpoints on
      // one address with different ports are one node, and one address.
      places: new Set(endpoints.map((e) => e.nodeId)).size,
      protocols: new Set(endpoints.map((e) => e.protocol)).size,
      online: rows.filter((r) => r.online).length,
      estimate: false as const,
    };
  }, [isEdit, estimate, endpointsQuery.data, nodesQuery.data]);

  function applyPreset(p: Preset) {
    setPresetId(p.id);
    form.setFieldValue('trafficLimitGb', p.trafficGb ?? '');
    form.setFieldValue('expireDays', p.expireDays ?? '');
    form.setFieldValue('trafficLimitStrategy', p.strategy);
  }

  function toggleSquad(id: string) {
    const has = form.values.groupIds.includes(id);
    form.setFieldValue(
      'groupIds',
      has ? form.values.groupIds.filter((x) => x !== id) : [...form.values.groupIds, id],
    );
  }

  async function handleSubmit(values: FormValues) {
    if (isEdit) {
      const input: UpdateUserInput = {
        status: values.status,
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb) || null,
        trafficLimitStrategy: values.trafficLimitStrategy,
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit: values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds: values.groupIds,
        routingPreset: values.routingPreset ? (values.routingPreset as never) : null,
      };
      await onSubmit(input);
    } else {
      const input: CreateUserInput = {
        username: values.username.trim(),
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb) || null,
        trafficLimitStrategy: values.trafficLimitStrategy,
        expireDays: values.expireDays === '' ? null : Number(values.expireDays),
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit: values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds: values.groupIds,
        ...(values.subscriptionToken ? { subscriptionToken: values.subscriptionToken.trim() } : {}),
        ...(values.routingPreset ? { routingPreset: values.routingPreset as never } : {}),
      };
      await onSubmit(input);
    }
    onClose();
  }

  const expiresAt =
    form.values.expireDays === ''
      ? null
      : new Date(Date.now() + Number(form.values.expireDays) * 86_400_000);

  return {
    isEdit,
    presets,
    form,
    squadsQuery,
    profilesQuery,
    bindingsQuery,
    nodesQuery,
    squads,
    nameProbe,
    nameQuery,
    nameTaken,
    nameFree,
    endpointsQuery,
    estimate,
    preview,
    applyPreset,
    toggleSquad,
    handleSubmit,
    expiresAt,
    advancedOpen,
    setAdvancedOpen,
    presetId,
    setPresetId,
  };
}

/** Everything the drawer hands to its sections. */
export type UserForm = ReturnType<typeof useUserForm>;
