import type { CreateUserInput, UpdateUserInput } from '@/lib/domain/users';
import type { FormValues } from '@/contours/users/lib/userForm';
import type { Preset } from '@/contours/users/lib/userPresets';
import type { PreviewData, PreviewRowData } from '@/contours/users/components/UserDrawer/PreviewCard';
import type { ExpirySpan } from '@/contours/users/lib/userExpiry';
import { ALL_SQUAD_ID, listRoutingPresets } from '@/lib/domain/routePolicies';
import { isRoutingPresetId, presetChoiceName, presetChoiceOf, presetChoicePatch, presetKey } from '@/lib/domain/routingPresets';
import { routingRow, type DeliveryView } from '@/contours/users/lib/routingRow';
import { GiB, defaultValues, trafficLimitInput, trafficLimitProblem, userUpdatePatch } from '@/contours/users/lib/userForm';
import { accessNoteKey, accessOutcome, storedAccessFacts } from '@/contours/users/lib/userAccess';
import { expiryDays } from '@/contours/users/lib/userExpiry';
import { endpointsWhy } from '@/contours/users/lib/endpointsWhy';
import { effectiveDeviceCap } from '@/contours/users/lib/deviceLimit';
import { userSaveRefusal } from '@/contours/users/lib/userSaveRefusal';
import { deliveryRouting, fetchUserEndpoints, getUserDelivery, listUsers } from '@/lib/domain/users';
import { listBindings, listProfiles } from '@/lib/domain/profiles';
import { listAllNodes } from '@/lib/domain/nodes';
import { listSquads } from '@/lib/domain/squads';
import { loadPresets } from '@/contours/users/lib/userPresets';
import { useMemo, useState } from 'react';
import { useNow } from '@/lib/ui/useNow';
import { useForm } from '@mantine/form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import { loadFailure, loadView } from '@/lib/ui/loadView';
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
   *
   * Время берётся из `useNow`, а не из `Date.now()` посреди рендера: рендер
   * обязан быть чистым. Шаг в минуту здесь ровно к месту, потому что стеречь
   * надо переход через полночь, а не секунду.
   */
  const clock = useNow(60_000);
  const [openedAt, setOpenedAt] = useState(clock);
  const now = useMemo(() => new Date(openedAt), [openedAt]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  /** Set by "create and next": save, then stay open on a blank draft. */
  const [createNext, setCreateNext] = useState(false);
  // Пресеты читаются из localStorage один раз на монтирование. `opened` в
  // зависимостях был лишним: дровер живёт в дереве постоянно, а список пресетов
  // от его открытия не меняется.
  const presets = useMemo(() => loadPresets(), []);

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
      trafficLimitGb: (v) => (trafficLimitProblem(v) ? t('validation.trafficWholeGb') : null),
    },
  });

  /**
   * Заполнение дровера при открытии.
   *
   * Сравнением в рендере, а не эффектом: эффект заполнял форму ПОСЛЕ отрисовки,
   * и первый кадр показывал прошлого юзера, а на создании ещё и пустые поля
   * вместо пресета. Ключ собран из того, что делает содержимое другим: факт
   * открытия, юзер и его версия.
   */
  const seedKey = opened ? `${user?.id ?? 'new'}:${user?.updatedAt ?? ''}` : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  /** The values the drawer opened with: the base an edit is diffed against. */
  const [seedValues, setSeedValues] = useState<FormValues | null>(null);
  /** A refused save in the server's words, said at the form (userSaveRefusal). */
  const [saveRefusal, setSaveRefusal] = useState<string | null>(null);
  if (seedKey !== null && seedKey !== seededFor) {
    setSeededFor(seedKey);
    {
      // A new account starts on the first preset rather than on nothing: an
      // empty form offers unlimited traffic and no expiry, which is the one
      // combination an operator almost never means.
      const seed = defaultValues(user);
      setSeedValues(seed);
      setSaveRefusal(null);
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
      setOpenedAt(clock);
    }
  }

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
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listAllNodes(), enabled: opened });
  // The operator's own presets for the routing picker and for naming a squad's
  // choice (A-229).
  const presetsQuery = useQuery({ queryKey: ['routing-presets'], queryFn: listRoutingPresets, enabled: opened });
  // What the server resolves this person's routing to, own presets included:
  // the card reads it rather than the form's guess (A-229).
  const deliveryQuery = useQuery({
    queryKey: ['user-delivery', user?.id],
    queryFn: () => getUserDelivery(user!.id),
    enabled: opened && isEdit,
  });
  const qc = useQueryClient();

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
  // «Free» only on an answer: a failed probe used to read as free, and the
  // operator then met CONFLICT on create (spec frontend-users).
  const nameFree = !isEdit && nameProbe.length >= 3 && nameQuery.isSuccess && !nameQuery.isFetching && !nameTaken;
  const nameUnchecked = !isEdit && nameProbe.length >= 3 && nameQuery.isError && !nameQuery.isFetching;
  /** The squad list did not arrive: said at the squads, not an empty choice. */
  const squadsFailure = loadFailure(squadsQuery, apiErrorMessage);

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
        // With the port: a profile stands on a node once per port (A-259), and
        // two rows with one node name would read as a duplicate.
        note: [node.countryCode?.toUpperCase(), String(b.port)].filter(Boolean).join(' · '),
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
      // A list the estimate is built from did not arrive: «0 configs» would
      // be a claim (spec frontend-users), so the card says it failed.
      why: [squadsQuery, profilesQuery, bindingsQuery, nodesQuery].some((q) => loadView(q) === 'failed') ? ('failed' as const) : null,
    };
  }, [form.values.groupIds, squads, squadsQuery, profilesQuery, bindingsQuery, nodesQuery]);

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
      // Why the list is empty, as the dial card says it (A-141): a 403, a
      // failed request and a real «nothing» are three different sentences.
      why: endpointsWhy({ data: endpointsQuery.data, isError: endpointsQuery.isError, error: endpointsQuery.error }),
    };
  }, [isEdit, estimate, endpointsQuery.data, endpointsQuery.isError, endpointsQuery.error, nodesQuery.data]);

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
  // The device limit the user is held to (A-148): their own, or the squads'
  // (All plus the picked ones, as the routing clash below counts them). No
  // squad list: an inherited limit is unknown, not «none».
  const deviceCap = useMemo(
    () =>
      effectiveDeviceCap(
        form.values.hwidDeviceLimit,
        loadView(squadsQuery) === 'ready'
          ? squads
              .filter((s) => s.id === ALL_SQUAD_ID || form.values.groupIds.includes(s.id))
              .map((s) => s.hwidDeviceLimit)
          : null,
      ),
    [form.values.hwidDeviceLimit, form.values.groupIds, squads, squadsQuery],
  );

  /** A picker value's name: a built-in in panel words, an own preset by the list. */
  const ownPresets = presetsQuery.data?.presets;
  const choiceName = useMemo(
    () => (choice: string) => presetChoiceName(choice, ownPresets, (id) => t(`metadata.preset${presetKey(id)}`)),
    [ownPresets, t],
  );

  // A squad's choice is one value too, a built-in or an own preset (A-229).
  const squadRoutingClash = useMemo(() => {
    const named = squads.filter(
      (s) => presetChoiceOf(s) !== '' && (s.id === ALL_SQUAD_ID || form.values.groupIds.includes(s.id)),
    );
    const distinct = new Set(named.map((s) => presetChoiceOf(s)));
    return distinct.size > 1
      ? named.map((s) => ({ name: s.name, preset: choiceName(presetChoiceOf(s)) ?? t('userDrawer.routingOwnUnnamed') }))
      : null;
  }, [squads, form.values.groupIds, choiceName, t]);

  /**
   * Where the routing this person gets comes from, when it comes from a squad.
   *
   * The preview used to print "inherits squad" and stop there, which is true
   * and useless: the operator still has to open every squad to find out which
   * one decides it. Named only when exactly one squad speaks, because that is
   * the one case where the answer is certain.
   */
  const squadRoutingSource = useMemo(() => {
    if (form.values.routingPreset) return null;
    const named = squads.filter(
      (s) => presetChoiceOf(s) !== '' && (s.id === ALL_SQUAD_ID || form.values.groupIds.includes(s.id)),
    );
    const distinct = new Set(named.map((s) => presetChoiceOf(s)));
    if (distinct.size !== 1 || !named[0]) return null;
    const choice = presetChoiceOf(named[0]);
    return { choice, preset: choiceName(choice) ?? t('userDrawer.routingOwnUnnamed'), squad: named[0].name };
  }, [squads, form.values.groupIds, form.values.routingPreset, choiceName, t]);

  // The card's routing row: the server's resolution for an untouched edit,
  // the form's reading for a draft (routingRow).
  const deliveryView: DeliveryView =
    loadView(deliveryQuery) === 'failed'
      ? { kind: 'failed' }
      : deliveryQuery.data === undefined
        ? { kind: 'loading' }
        : { kind: 'ready', routing: deliveryRouting(deliveryQuery.data) };
  const routing = routingRow({
    draft: form.values.routingPreset,
    seed: isEdit ? (seedValues?.routingPreset ?? null) : null,
    delivery: deliveryView,
    squads: { source: squadRoutingSource, clash: squadRoutingClash !== null },
    choiceName,
    refName: (ref) => (ref.builtIn && isRoutingPresetId(ref.id) ? t(`metadata.preset${presetKey(ref.id)}`) : ref.name),
    words: {
      inherits: t('userDrawer.inheritsSquad'),
      unnamed: t('userDrawer.routingOwnUnnamed'),
      unknown: t('userDrawer.routingUnknown'),
      loading: t('common.loading'),
    },
  });

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

  /**
   * A refused save, read where it belongs (userSaveRefusal): fields the
   * server names are marked on the field, the rest is said at the form. The
   * drawer stays open on the draft; nothing is thrown out of the submit.
   */
  async function submit(input: CreateUserInput | UpdateUserInput): Promise<boolean> {
    setSaveRefusal(null);
    try {
      await onSubmit(input);
      return true;
    } catch (err) {
      const refusal = userSaveRefusal(err, (code) =>
        t(
          code === 'USERNAME_TAKEN'
            ? 'userDrawer.usernameTaken'
            : code === 'SUBSCRIPTION_TOKEN_TAKEN'
              ? 'userDrawer.tokenTaken'
              : 'userDrawer.routingPresetGone',
        ),
      );
      // The own preset picked was deleted meanwhile: the picker reads the
      // list again (A-229).
      if (refusal?.fields.routingPreset) {
        qc.invalidateQueries({ queryKey: ['routing-presets'] });
        setAdvancedOpen(true);
      }
      if (refusal) {
        for (const [field, text] of Object.entries(refusal.fields)) form.setFieldError(field, text);
        setSaveRefusal(refusal.message);
      }
      return false;
    }
  }

  async function handleSubmit(values: FormValues) {
    const chosenExpiry =
      values.expireDays === ''
        ? null
        : new Date(now.getTime() + Number(values.expireDays) * 86_400_000);

    if (isEdit) {
      // Only what changed against the seed (userUpdatePatch): a field the
      // operator did not touch is not restated, so a change made meanwhile by
      // the bot or another tab stands. Nothing changed: nothing is sent.
      const input: UpdateUserInput = userUpdatePatch(seedValues ?? defaultValues(user), values, chosenExpiry);
      if (Object.keys(input).length === 0) {
        onClose();
        return;
      }
      if (!(await submit(input))) return;
    } else {
      const input: CreateUserInput = {
        username: values.username.trim(),
        trafficLimitGb: trafficLimitInput(values.trafficLimitGb),
        trafficLimitStrategy: values.trafficLimitStrategy,
        expireDays: values.expireDays === '' ? null : Number(values.expireDays),
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit: values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds: values.groupIds,
        ...(values.subscriptionToken ? { subscriptionToken: values.subscriptionToken.trim() } : {}),
        ...presetChoicePatch('', values.routingPreset),
      };
      if (!(await submit(input))) return;
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

  /**
   * Where the access control lands this user on save (A-294, userAccess): the
   * date and the quota as the form stands now, the stored ones until touched.
   * The limit is read from the user while the field keeps its seed, because
   * the field holds whole GiB and the stored limit may not.
   */
  const accessSeed = seedValues?.status ?? 'active';
  const formLimitGb = trafficLimitInput(form.values.trafficLimitGb);
  const access = user
    ? accessOutcome(
        form.values.status,
        {
          ...storedAccessFacts(user),
          expiresAt,
          ...(form.values.trafficLimitGb !== seedValues?.trafficLimitGb
            ? { limitBytes: formLimitGb === null ? null : formLimitGb * GiB }
            : {}),
        },
        now,
      )
    : null;
  const accessNote = access ? accessNoteKey(accessSeed, access) : null;

  return {
    now,
    access,
    accessNote,
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
    nameUnchecked,
    squadsFailure,
    endpointsQuery,
    estimate,
    preview,
    deviceCap,
    squadRoutingClash,
    squadRoutingSource,
    presetsQuery,
    choiceName,
    routing,
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
    saveRefusal,
  };
}

/** Everything the modal hands to its sections. */
export type UserForm = ReturnType<typeof useUserForm>;
