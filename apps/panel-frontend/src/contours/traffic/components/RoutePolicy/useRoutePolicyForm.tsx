import { Stack, Text } from '@mantine/core';
import { listCascades } from '@/lib/domain/cascades';
import type { DraftRule } from '@/contours/traffic/lib/routeRules';
import { NEW_POLICY_ID, findShadows, strip, toRules } from '@/contours/traffic/lib/routeRules';
import { apiErrorMessage } from '@/lib/net/client';
import {
  createRoutePolicy,
  deleteRoutePolicy,
  policyConflict,
  policyEntryOf,
  policyEntryUnknown,
  routePolicyInUse,
  toPolicyInput,
  updateRoutePolicy,
} from '@/lib/domain/routePolicies';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RoutePolicy } from '@/lib/domain/routePolicies';
import type { Squad } from '@/lib/domain/squads';

/**
 * The draft a policy is edited as: its name, its rules in order, what is dirty,
 * which rows are shadowed by an earlier one, and the save and delete calls.
 * The editor keeps layout only.
 */
export function useRoutePolicyForm(policy: RoutePolicy, squads: Squad[], onCreated?: () => void) {
  const { t } = useTranslation();

  const qc = useQueryClient();
  // Счётчик ТОЛЬКО для строк, которые оператор добавляет руками: там мы в
  // обработчике события, а не в рендере. Ключи строк, пришедших с сервера,
  // детерминированы и живут в `toRules`.
  const nextKey = useRef(0);

  const initial = useMemo(() => toRules(policy), [policy]);
  const [name, setName] = useState(policy.name);
  const [rules, setRules] = useState<DraftRule[]>(initial);
  const [loadedFor, setLoadedFor] = useState(policy.id);
  const [dragging, setDragging] = useState<number | null>(null);
  /** Записи из отказа ROUTE_POLICY_ENTRY_UNKNOWN: подсветка до правки строки. */
  const [unknownEntries, setUnknownEntries] = useState<string[]>([]);

  // Re-seed when the operator picks a different policy in the list.
  if (loadedFor !== policy.id) {
    setLoadedFor(policy.id);
    setName(policy.name);
    setRules(toRules(policy));
    setDragging(null);
    setUnknownEntries([]);
  }

  // A policy that has never been saved is dirty by definition, even straight
  // out of an imported file where nothing has been typed yet.
  const dirty =
    policy.id === NEW_POLICY_ID ||
    name !== policy.name ||
    JSON.stringify(strip(rules)) !== JSON.stringify(strip(initial));
  const shadows = useMemo(() => findShadows(rules), [rules]);
  const granted = squads.filter((s) => s.policyIds.includes(policy.id));

  const saveMutation = useMutation({
    mutationFn: () => {
      // The API keeps two flat domain lists, so the ordered rules fold down on
      // save. The band is never sent: it is the API's to assign, and on an
      // existing policy it cannot move at all.
      const input = toPolicyInput(name.trim() || policy.name, strip(rules));
      return policy.id === NEW_POLICY_ID ? createRoutePolicy(input) : updateRoutePolicy(policy.id, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route-policies'] });
      notifications.show({ color: 'green', message: t('routes.policySaved') });
      onCreated?.();
    },
    onError: (err) => {
      // Записи, которые ни имя, ни адрес (265e93e): подсвечиваются в своих
      // строках, в тосте одна фраза со списком.
      const unknown = policyEntryUnknown(err);
      if (unknown) {
        setUnknownEntries(unknown);
        notifications.show({
          color: 'red',
          title: t('common.saveError'),
          message: t('routes.entryUnknown', { entries: unknown.join(', ') }),
        });
        return;
      }
      // A name or band collision, or a policy with no domains at all: the API
      // says which, and the fix differs, so its sentence is the useful one.
      const named = policyConflict(err);
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: named ?? apiErrorMessage(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoutePolicy(policy.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route-policies'] });
      notifications.show({ color: 'green', message: t('routes.policyDeleted') });
      onCreated?.();
    },
    onError: (err) => {
      // Политика стоит входом у каскадов (409 ROUTE_POLICY_IN_USE): имена, а
      // не общая строка, как у E28. Заранее это ловит policyEntryOf ниже.
      const inUse = routePolicyInUse(err);
      if (inUse) qc.invalidateQueries({ queryKey: ['cascades'] });
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: inUse
          ? t('routes.policyEntryOf', { count: inUse.cascades.length, names: inUse.cascades.map((c) => `«${c.name}»`).join(', ') })
          : apiErrorMessage(err),
      });
    },
  });

  // Каскады, у которых политика стоит входом: факт из списка каскадов. Есть
  // такие, удаление недоступно заранее; факта нет (сервер старше), только 409.
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  const entryOf = policyEntryOf(policy.id, cascadesQuery.data?.cascades, cascadesQuery.data?.fields);

  function setRule(i: number, patch: Partial<DraftRule>) {
    // Правка строки: подсветка отказа про неё становится неверной, сервер
    // скажет заново на следующем сохранении.
    if (patch.match) setUnknownEntries([]);
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((prev) => [
      ...prev,
      { id: `new-${nextKey.current++}`, match: [], action: 'direct', note: '' },
    ]);
  }
  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, j) => j !== i));
  }
  /** Move `from` to `to`, the way a drop reads: the row lands where it hovers. */
  function move(from: number, to: number) {
    if (from === to) return;
    setRules((prev) => {
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
  }

  function confirmDelete() {
    const blocked = (entryOf?.length ?? 0) > 0;
    modals.openConfirmModal({
      title: t('routes.policyDeleteTitle', { name: policy.name }),
      children: (
        <Stack gap="sm">
          {blocked && (
            <Text size="sm" c="red">
              {t('routes.policyEntryOf', { count: entryOf!.length, names: entryOf!.map((n) => `«${n}»`).join(', ') })}
            </Text>
          )}
          <Text size="sm">
            {granted.length > 0
              ? t('routes.policyDeleteGranted', { count: granted.length })
              : t('routes.policyDeleteSafe')}
          </Text>
        </Stack>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red', disabled: blocked, title: blocked ? t('routes.policyEntryOfHint') : undefined },
      onConfirm: () => deleteMutation.mutate(),
    });
  }

  return {
    qc,
    nextKey,
    initial,
    dirty,
    shadows,
    granted,
    saveMutation,
    deleteMutation,
    setRule,
    addRule,
    removeRule,
    move,
    confirmDelete,
    name,
    setName,
    rules,
    setRules,
    loadedFor,
    setLoadedFor,
    dragging,
    setDragging,
    unknownEntries,
  };
}

/** Everything the editor hands to its sections. */
export type RoutePolicyForm = ReturnType<typeof useRoutePolicyForm>;
