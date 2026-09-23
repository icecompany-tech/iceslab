import { useTranslation } from 'react-i18next';
import { Select, Stack, Text } from '@mantine/core';
import type { CoreComponent, NodeCoreVersions } from '@iceslab/shared';
import { coreReleaseOptions } from '@/lib/domain/coreVersions';
import { FAINT } from '@/contours/nodes/lib/colors';

/**
 * Which release a node should run for one core component: the manifest's
 * releases, «пин манифеста» first (no key = the pin, and it follows the
 * manifest when the pin moves), known-bad and above-ceiling listed but not
 * choosable, with the reason. One picker for the node page's «Ядра» and the
 * create wizard, so the two never offer different lists.
 */
export function CoreVersionSelect({
  component,
  intent,
  onIntent,
  ariaLabel,
  width = 300,
}: {
  component: CoreComponent;
  intent: NodeCoreVersions;
  onIntent: (next: NodeCoreVersions) => void;
  ariaLabel: string;
  width?: number;
}) {
  const { t } = useTranslation();
  const options = coreReleaseOptions(component);
  const byVersion = new Map(options.map((o) => [o.version, o] as const));
  const pinned = options.find((o) => o.isPin)?.version ?? '';
  return (
    <Select
      size="xs"
      w={width}
      allowDeselect={false}
      aria-label={ariaLabel}
      value={intent[component] ?? ''}
      data={[
        { value: '', label: t('nodeEdit.coreVer.pinOption', { v: pinned }) },
        ...options.map((o) => ({
          value: o.version,
          label: [
            o.version,
            o.isPin ? t('nodeEdit.coreVer.isPin') : null,
            o.blocked ? t(`nodeEdit.coreVer.blocked.${o.blocked.kind}`) : null,
          ]
            .filter(Boolean)
            .join(' · '),
          disabled: o.blocked !== null,
        })),
      ]}
      renderOption={({ option }) => {
        const o = byVersion.get(option.value);
        return (
          <Stack gap={2}>
            <Text style={{ fontSize: 12 }}>{option.label}</Text>
            {o?.blocked && <Text style={{ fontSize: 11, lineHeight: '15px', color: FAINT }}>{o.blocked.reason}</Text>}
          </Stack>
        );
      }}
      onChange={(v) => {
        const next = { ...intent };
        if (!v) delete next[component];
        else next[component] = v;
        onIntent(next);
      }}
    />
  );
}
