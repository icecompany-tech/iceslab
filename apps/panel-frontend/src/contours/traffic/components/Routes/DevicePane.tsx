import type { RoutingPresetId } from '@iceslab/shared';
import type { RoutingPreset } from '@/lib/domain/routePolicies';
import type { Squad } from '@/lib/domain/squads';
import { Box, Stack } from '@mantine/core';
import { DevicePresetEditor } from '@/contours/traffic/components/DevicePresetEditor';
import { ListHead, ListRow } from '@/contours/traffic/components/Routes/RuleList';
import { OwnRules } from '@/contours/traffic/components/Routes/OwnRules';
import { PRESET_DNS } from '@/contours/traffic/lib/devicePresets';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
export function DevicePane({
  presets,
  defaultPreset,
  squads,
  draft,
  draftKey,
  onDraftDone,
}: {
  presets: RoutingPreset[];
  defaultPreset: RoutingPresetId;
  squads: Squad[];
  draft: RoutingPreset | null;
  draftKey: number;
  onDraftDone: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(defaultPreset);

  const preset = draft ?? presets.find((p) => p.id === selected) ?? presets[0]!;
  const usedBy = (id: string) => squads.filter((s) => s.routingPreset === id).length;

  return (
    <Box className="routes-panes">
      <Stack gap={0} className="routes-list">
        <ListHead label={t('routes.presetsTitle')} count={presets.length} />

        {draft && (
          <ListRow
            selected
            title={draft.name || t('routes.newPreset')}
            sub={t('routes.newPolicySub')}
            onClick={() => undefined}
          />
        )}

        {presets.map((p) => {
          const squadCount = usedBy(p.id);
          return (
            <ListRow
              key={p.id}
              selected={!draft && selected === p.id}
              title={p.name}
              sub={[
                p.rules.length > 0 ? t('routes.ruleCount', { count: p.rules.length }) : t('routes.noRulesShort'),
                p.id === defaultPreset ? t('routes.isDefault') : null,
                squadCount > 0 ? t('routes.squadCount', { count: squadCount }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              badge={t('routes.builtIn')}
              onClick={() => {
                onDraftDone();
                setSelected(p.id);
              }}
            />
          );
        })}
      </Stack>

      <DevicePresetEditor
        key={draft ? `draft-${draftKey}` : preset.id}
        preset={preset}
        isDefault={!draft && preset.id === defaultPreset}
        dns={draft ? undefined : PRESET_DNS[preset.id as RoutingPresetId]}
        onSaved={onDraftDone}
      />

      <Box className="routes-full">
        <OwnRules />
      </Box>
    </Box>
  );
}

/** i18n suffix for a preset id, so the labels stay in one place. */

/* ───── The operator's own layer ────────────────────────────────────────── */

/**
 * The only part of on-device routing that is stored rather than compiled: the
 * operator's domain lists and raw Xray rules. They are emitted BEFORE the
 * preset, which is why they sit under it here with that said out loud.
 */
