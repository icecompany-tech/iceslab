import { useTranslation } from 'react-i18next';
import { AMBER, DISPLAY, MIST, MOSS } from '@/contours/nodes/lib/colors';
import { Box, Text } from '@mantine/core';
import { TickIcon, WarnIcon } from '@/contours/nodes/components/NodeEdit/icons';
export function ExposureNote({
  result,
}: {
  result: { checked: boolean; unexpectedPorts?: number[]; note?: string };
}) {
  const { t } = useTranslation();
  const clean = result.checked && (result.unexpectedPorts ?? []).length === 0;
  const tone = !result.checked ? MIST : clean ? MOSS : AMBER;
  const text = !result.checked
    ? t('nodes.form.exposureSkipped', { note: result.note ?? '-' })
    : clean
      ? t('nodes.form.exposureClean')
      : t('nodes.form.exposureExtra', { ports: (result.unexpectedPorts ?? []).join(', ') });
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 12px',
        borderRadius: 8,
        backgroundColor: `${tone}0F`,
        border: `1px solid ${tone}2E`,
        width: '100%',
      }}
    >
      {clean ? <TickIcon size={13} color={tone} /> : <WarnIcon size={13} color={tone} />}
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: tone, flex: 1 }}>{text}</Text>
    </Box>
  );
}

/** One way out of the node. The selected row lifts on a faint cyan wash. */
