import { useTranslation } from 'react-i18next';
import { Select, Stack, Text } from '@mantine/core';
import type { CoreComponent, NodeCoreVersions } from '@iceslab/shared';
import { coreVersionChoices } from '@/lib/domain/coreVersions';
import { FAINT } from '@/contours/nodes/lib/colors';

/**
 * Which release a node should run for one core component: «Рекомендуемая»
 * first (no key = the manifest's pin, and it follows the manifest when the
 * pin moves), then each release as «Закрепить», known-bad and above-ceiling
 * listed but not choosable, with the reason. The words are coreVersionChoices'.
 * One picker for the node page's «Ядра» and the create wizard, so the two
 * never offer different lists or different words.
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
  const choices = coreVersionChoices(component);
  const byValue = new Map(choices.map((c) => [c.value, c] as const));
  return (
    <Select
      size="xs"
      w={width}
      allowDeselect={false}
      aria-label={ariaLabel}
      value={intent[component] ?? ''}
      data={choices.map((c) => ({
        value: c.value,
        label: [t(`nodeEdit.coreVer.choice.${c.kind}`, { v: c.v }), c.blocked ? t(`nodeEdit.coreVer.blocked.${c.blocked.kind}`) : null]
          .filter(Boolean)
          .join(' · '),
        disabled: c.blocked !== null,
      }))}
      renderOption={({ option }) => {
        const c = byValue.get(option.value);
        return (
          <Stack gap={2}>
            <Text style={{ fontSize: 12 }}>{option.label}</Text>
            {c?.blocked && <Text style={{ fontSize: 11, lineHeight: '15px', color: FAINT }}>{c.blocked.reason}</Text>}
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

/**
 * Одна строка под выбором версий: чем рекомендуемая отличается от
 * закреплённой. Одна на блок, а не под каждым селектором: в блоке их до
 * восьми, и повтор под каждым читался бы как восемь разных оговорок.
 */
export function CoreVersionNote() {
  const { t } = useTranslation();
  return <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>{t('nodeEdit.coreVer.choiceNote')}</Text>;
}
