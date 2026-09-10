import { Box, Card, Group, Stack, Text } from '@mantine/core';
import { CARD, HAIRLINE, SNOW } from '@/contours/users/lib/colors';
import { DISPLAY } from '@/contours/users/lib/textStyles';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
export interface StatChipProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}

export function StatChip({ icon, label, value, accent, active, onClick }: StatChipProps) {
  return (
    <Card
      withBorder
      padding={12}
      radius={8}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? active : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: CARD,
        borderColor: active ? accent : HAIRLINE,
        borderWidth: active ? 2 : 1,
      }}
    >
      {/* Bare outline icon, no filled badge: the number is the content here,
          the icon only names the bucket. */}
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2}>
          <Text style={MONO_LABEL}>{label}</Text>
          <Text style={{ ...DISPLAY, fontSize: 28, fontWeight: 500, lineHeight: 1, color: SNOW }}>
            {value}
          </Text>
        </Stack>
        <Box style={{ color: accent, display: 'flex', flexShrink: 0 }}>{icon}</Box>
      </Group>
    </Card>
  );
}

// ───── Main page ─────
