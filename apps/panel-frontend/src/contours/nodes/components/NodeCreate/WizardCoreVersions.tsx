import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import type { CoreComponent, NodeCoreVersions } from '@iceslab/shared';
import { CoreVersionSelect } from '@/contours/nodes/components/CoreVersionSelect';
import { wizardCoreComponents } from '@/contours/nodes/lib/nodeCreateForm';
import { FAINT, HAIRLINE, MIST, MONO, RED, SNOW } from '@/contours/nodes/lib/colors';

/**
 * «Версии ядер» в мастере создания ноды (решение владельца 24.09: версию ядра
 * выбирают только при создании ноды и в её настройках). Те же строки, что в
 * секции «Ядра» страницы ноды, но без факта: ноды ещё нет. Сначала ядра
 * всех выбранных движков, остальные под «остальные ядра». Ничего не выбрано =
 * пины манифеста.
 */
export function WizardCoreVersions({
  engines,
  value,
  onChange,
  refusal,
}: {
  /** The engines the node is set up to carry: their components come first. */
  engines: readonly string[];
  value: NodeCoreVersions;
  onChange: (next: NodeCoreVersions) => void;
  refusal: string[] | null;
}) {
  const { t } = useTranslation();
  const [othersOpen, setOthersOpen] = useState(false);
  const { relevant, others } = wizardCoreComponents(engines);
  // Выбор в свёрнутой группе не прячем: раскрываем, если там что-то выбрано.
  const othersShown = othersOpen || others.some((c) => value[c] !== undefined);

  const row = (c: CoreComponent) => (
    <Box key={c} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW, minWidth: 150 }}>
        {t(`profiles.engine.component.${c}`)}
      </Text>
      <CoreVersionSelect component={c} intent={value} onIntent={onChange} ariaLabel={c} />
    </Box>
  );

  return (
    <Stack gap={8} style={{ padding: '12px 14px', borderRadius: 8, border: `1px solid ${HAIRLINE}` }}>
      <Text
        style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}
      >
        {t('nodes.form.coreVersionsTitle')}
      </Text>

      {refusal && (
        <Box style={{ padding: '8px 10px', borderRadius: 8, backgroundColor: `${RED}14`, border: `1px solid ${RED}40` }}>
          <Text style={{ fontSize: 12, lineHeight: '17px', color: RED, fontWeight: 500 }}>
            {t('nodeEdit.coreVer.refused')}
          </Text>
          {refusal.map((line) => (
            <Text key={line} style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: SNOW, marginTop: 4 }}>
              {line}
            </Text>
          ))}
        </Box>
      )}

      {relevant.map(row)}

      {others.length > 0 && (
        <>
          <UnstyledButton
            type="button"
            onClick={() => setOthersOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Text style={{ fontSize: 12, color: MIST }}>{t('nodes.form.coreVersionsOthers', { count: others.length })}</Text>
            <IconChevronDown
              size={12}
              stroke={2}
              color={MIST}
              style={{ transform: othersShown ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
            />
          </UnstyledButton>
          {othersShown && others.map(row)}
        </>
      )}

      <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>{t('nodes.form.coreVersionsNote')}</Text>
    </Stack>
  );
}
