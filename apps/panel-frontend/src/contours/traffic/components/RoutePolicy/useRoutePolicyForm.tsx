import { Text } from '@mantine/core';
import type { DraftRule } from '@/contours/traffic/lib/routeRules';
import { NEW_POLICY_ID, findShadows, strip, toRules } from '@/contours/traffic/lib/routeRules';
import { apiErrorMessage } from '@/lib/net/client';
import { createRoutePolicy, deleteRoutePolicy, policyConflict, toPolicyInput, updateRoutePolicy } from '@/lib/domain/routePolicies';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  const nextKey = useRef(0);

  const initial = useMemo(() => toRules(policy, () => `r${nextKey.current++}`), [policy]);
  const [name, setName] = useState(policy.name);
  const [rules, setRules] = useState<DraftRule[]>(initial);
  const [loadedFor, setLoadedFor] = useState(policy.id);
  const [dragging, setDragging] = useState<number | null>(null);

  // Re-seed when the operator picks a different policy in the list.
  if (loadedFor !== policy.id) {
    setLoadedFor(policy.id);
    setName(policy.name);
    setRules(toRules(policy, () => `r${nextKey.current++}`));
    setDragging(null);
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
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.deleteError'), message: apiErrorMessage(err) }),
  });

  function setRule(i: number, patch: Partial<DraftRule>) {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((prev) => [
      ...prev,
      { id: `r${nextKey.current++}`, match: [], action: 'direct', note: '' },
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
    modals.openConfirmModal({
      title: t('routes.policyDeleteTitle', { name: policy.name }),
      children: (
        <Text size="sm">
          {granted.length > 0
            ? t('routes.policyDeleteGranted', { count: granted.length })
            : t('routes.policyDeleteSafe')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
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
  };
}

/** Everything the editor hands to its sections. */
export type RoutePolicyForm = ReturnType<typeof useRoutePolicyForm>;
