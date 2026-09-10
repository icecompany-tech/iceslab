import { Box, Stack, Text, Textarea } from '@mantine/core';
import { DISPLAY, FAINT, MONO, SNOW } from '@/contours/traffic/lib/colors';
export function Bucket({
  tone,
  label,
  hint,
  placeholder,
  value,
  onChange,
}: {
  tone: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: tone,
          }}
        >
          {label}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Box>
      <Textarea
        autosize
        minRows={4}
        maxRows={10}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        styles={{ input: { fontFamily: MONO, fontSize: 12, lineHeight: '17px', color: SNOW } }}
      />
    </Stack>
  );
}
