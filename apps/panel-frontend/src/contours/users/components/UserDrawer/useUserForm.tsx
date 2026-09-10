import type { CreateUserInput, UpdateUserInput } from '@/lib/domain/users';
import type { FormValues } from '@/contours/users/lib/userForm';
import type { Preset } from '@/contours/users/lib/userPresets';
import type { PreviewData, PreviewRowData } from '@/contours/users/components/UserDrawer/PreviewCard';
import type { ExpirySpan } from '@/contours/users/lib/userExpiry';
import { ALL_SQUAD_ID } from '@/lib/domain/routePolicies';
import { defaultValues } from '@/contours/users/lib/userForm';
import { expiryDays } from '@/contours/users/lib/userExpiry';
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
 * what the subscription will hand out. The modal keeps layout only.
 */
export function useUserForm({ opened, user, onSubmit, onClose }: Props) {
  const { t } = useTranslation();

  const isEdit = user !== null;
  /**
   * One clock for the whole session of the form, stamped when it opens. Every
   * expiry date, and the lookup that turns a stored day count back into "30
   * days", is measured from it: a clock read per render would let the label and
   * the date beside it disagree across midnight.
   */
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const now = useMemo(() => new Date(openedAt), [openedAt]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  /** Set by "create and next": save, then stay open on a blank draft. */
  const [createNext, setCreateNext] = useState(false);
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
      // A new account starts on the first preset rather than on nothing: an
      // empty form offers unlimited traffic and no expiry, which is the one
      // combination an operator almost never means.
      const seed = defaultValues(user);
      const first = user === null ? presets[0] : undefined;
      form.setValues(
        first
          ? {
              ...seed,
              trafficLimitGb: first.trafficGb ?? '',
              expireDays: first.expireDays ?? '',
              expirySet: true,
              trafficLimitStrategy: first.strategy,
            }
          : seed,
      );
      setAdvancedOpen(false);
      setPresetId(first?.id ?? null);
      setCreateNext(false);
      setOpenedAt(Date.now());
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

  // Memoised because two derived blocks below key off it: a fresh [] per render
  // would recompute the estimate and the routing check on every keystroke.
  const squads = useMemo(() => squadsQuery.data?.squads ?? [], [squadsQuery.data]);

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

  /**
   * Which squads name a routing preset, when they name more than one.
   *
   * Mirrors `resolveSquadRouting` (panel-backend
   * `subscription.service.ts:119`): one distinct preset across the member
   * squads wins, two or more cancel out and the person drops to the panel
   * default. Only the disagreement is drawn from this. What the panel hands
   * out instead is the backend's answer and is not exposed to this screen, so
   * the effective value in the preview still reads "inherits squad".
   *
   * Every user is in All whether or not the form lists it, so All's own preset
   * counts here exactly as the backend counts it.
   */
  const squadRoutingClash = useMemo(() => {
    const named = squads.filter(
      (s) =>
        s.routingPreset !== null &&
        (s.id === ALL_SQUAD_ID || form.values.groupIds.includes(s.id)),
    );
    const distinct = new Set(named.map((s) => s.routingPreset));
    return distinct.size > 1 ? named.map((s) => ({ name: s.name, preset: s.routingPreset! })) : null;
  }, [squads, form.values.groupIds]);

  function applyPreset(p: Preset) {
    setPresetId(p.id);
    form.setFieldValue('trafficLimitGb', p.trafficGb ?? '');
    form.setFieldValue('expireDays', p.expireDays ?? '');
    form.setFieldValue('expirySet', true);
    form.setFieldValue('trafficLimitStrategy', p.strategy);
  }

  /** The expiry picker writes a day count, the same unit a preset carries. */
  function setExpiry(span: ExpirySpan) {
    form.setFieldValue('expireDays', expiryDays(span, now));
    form.setFieldValue('expirySet', true);
  }

  function toggleSquad(id: string) {
    const has = form.values.groupIds.includes(id);
    form.setFieldValue(
      'groupIds',
      has ? form.values.groupIds.filter((x) => x !== id) : [...form.values.groupIds, id],
    );
  }

  async function handleSubmit(values: FormValues) {
    const chosenExpiry =
      values.expireDays === ''
        ? null
        : new Date(now.getTime() + Number(values.expireDays) * 86_400_000);

    if (isEdit) {
      const input: UpdateUserInput = {
        // Sent only when this session picked a span. An untouched edit leaves
        // the field out entirely rather than restating the stored date.
        ...(values.expirySet ? { expireAt: chosenExpiry?.toISOString() ?? null } : {}),
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

    // "Create and next" keeps the modal up and hands back a blank draft on the
    // same preset, so a batch of accounts is one visit instead of ten.
    if (createNext && !isEdit) {
      const first = presets[0];
      form.setValues({
        ...defaultValues(null),
        ...(first
          ? {
              trafficLimitGb: first.trafficGb ?? '',
              expireDays: first.expireDays ?? '',
              expirySet: true,
              trafficLimitStrategy: first.strategy,
            }
          : {}),
      });
      setPresetId(first?.id ?? null);
      setCreateNext(false);
      return;
    }
    onClose();
  }

  /**
   * The day the subscription runs out, as the form currently stands. Until a
   * span is picked, an existing user keeps the date they already carry: the
   * preview used to read "no expiry" for everyone on edit, because the picker
   * starts empty and the stored date was never consulted.
   */
  const expiresAt = form.values.expirySet
    ? form.values.expireDays === ''
      ? null
      : new Date(now.getTime() + Number(form.values.expireDays) * 86_400_000)
    : user?.expireAt
      ? new Date(user.expireAt)
      : null;

  return {
    now,
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
    squadRoutingClash,
    setCreateNext,
    applyPreset,
    setExpiry,
    toggleSquad,
    handleSubmit,
    expiresAt,
    advancedOpen,
    setAdvancedOpen,
    presetId,
    setPresetId,
  };
}

/** Everything the modal hands to its sections. */
export type UserForm = ReturnType<typeof useUserForm>;
