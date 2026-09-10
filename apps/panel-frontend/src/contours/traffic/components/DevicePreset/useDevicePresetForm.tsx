import { Text } from '@mantine/core';
import type { RouteRule } from '@/lib/domain/routePolicies';
import { NEW_PRESET_ID } from '@/contours/traffic/lib/devicePresets';
import { apiErrorMessage } from '@/lib/net/client';
import { createRoutingPreset, deleteRoutingPreset, updateRoutingPreset } from '@/lib/domain/routePolicies';
import { findShadows, strip } from '@/contours/traffic/lib/devicePresetRules';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RoutingPreset } from '@/lib/domain/routePolicies';

/**
 * The draft a device preset is edited as: its name, its rules in order, what is
 * dirty, which rows an earlier row already swallowed, and the save and delete
 * calls. A built-in preset is locked, and the flag travels with the draft.
 */
export function useDevicePresetForm(preset: RoutingPreset, onSaved?: () => void) {
  const { t } = useTranslation();

  const qc = useQueryClient();
  const nextKey = useRef(0);

  const initial = useMemo(
    () => preset.rules.map((r) => ({ ...r, id: r.id || `d${nextKey.current++}` })),
    [preset],
  );
  const [name, setName] = useState(preset.name);
  const [rules, setRules] = useState<RouteRule[]>(initial);
  const [loadedFor, setLoadedFor] = useState(preset.id);
  const [dragging, setDragging] = useState<number | null>(null);

  if (loadedFor !== preset.id) {
    setLoadedFor(preset.id);
    setName(preset.name);
    setRules(preset.rules.map((r) => ({ ...r, id: r.id || `d${nextKey.current++}` })));
    setDragging(null);
  }

  const locked = preset.builtIn;
  // A preset that has never been saved is dirty by definition, even straight
  // out of an imported file where nothing has been typed yet.
  const dirty =
    !locked &&
    (preset.id === NEW_PRESET_ID ||
      name !== preset.name ||
      JSON.stringify(strip(rules)) !== JSON.stringify(strip(initial)));
  const shadows = useMemo(() => findShadows(rules), [rules]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { name: name.trim() || preset.name, rules: strip(rules) };
      return preset.id === NEW_PRESET_ID
        ? createRoutingPreset(input)
        : updateRoutingPreset(preset.id, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing-presets'] });
      notifications.show({ color: 'green', message: t('routes.presetSaved') });
      onSaved?.();
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRoutingPreset(preset.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing-presets'] });
      notifications.show({ color: 'green', message: t('routes.presetDeleted') });
      onSaved?.();
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.deleteError'), message: apiErrorMessage(err) }),
  });

  function setRule(i: number, patch: Partial<RouteRule>) {
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setRules((prev) => [...prev, { id: `d${nextKey.current++}`, match: [], action: 'direct', note: '' }]);
  }
  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, j) => j !== i));
  }
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
      title: t('routes.presetDeleteTitle', { name: preset.name }),
      children: <Text size="sm">{t('routes.presetDeleteBody')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(),
    });
  }

  return {
    qc,
    nextKey,
    initial,
    locked,
    dirty,
    shadows,
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

/** Everything the preset editor hands to its sections. */
export type DevicePresetForm = ReturnType<typeof useDevicePresetForm>;
