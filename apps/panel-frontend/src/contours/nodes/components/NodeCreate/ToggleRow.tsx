import { Box, Stack, Switch, Text } from '@mantine/core';
import { DISPLAY, FAINT, HAIRLINE, SNOW, WELL } from '@/contours/nodes/lib/colors';
export function ToggleRow({
  checked,
  onChange,
  title,
  hint,
  titleSize = 12,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
  titleSize?: number;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        width: '100%',
      }}
    >
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        style={{ flexShrink: 0 }}
      />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: titleSize, fontWeight: 500, lineHeight: '17px', color: SNOW }}>
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Stack>
    </Box>
  );
}
