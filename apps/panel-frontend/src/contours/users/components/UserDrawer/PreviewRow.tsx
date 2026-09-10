import { IconPencil } from '@tabler/icons-react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { DISPLAY, MIST, MONO, SNOW } from '@/contours/users/lib/colors';
export function Count({ value, label }: { value: number; label: string }) {
  return (
    <>
      <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: SNOW }}>{value}</Text>
      <Text style={{ fontFamily: MONO, fontSize: 12, color: MIST }}>{label}</Text>
    </>
  );
}

export function PreviewRow({
  label,
  value,
  note,
  onEdit,
}: {
  label: string;
  value: string;
  note?: string;
  onEdit?: () => void;
}) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', color: MIST }}>
        {label}
      </Text>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW }}>{value}</Text>
        {note && <Text style={{ fontFamily: DISPLAY, fontSize: 11, color: MIST }}>{note}</Text>}
        {onEdit && (
          <UnstyledButton onClick={onEdit} style={{ display: 'flex', color: MIST }}>
            <IconPencil size={13} stroke={1.8} />
          </UnstyledButton>
        )}
      </Box>
    </Box>
  );
}
