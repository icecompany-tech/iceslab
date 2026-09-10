import type { UserSort } from '@/lib/domain/users';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { CYAN, MIST, SNOW } from '@/contours/users/lib/colors';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
export function HeadCell({
  label,
  width,
  grow,
  col,
  sort,
  order,
  onSort,
}: {
  label: string;
  width?: number;
  grow?: boolean;
  /** Present = the column is sortable and clicking cycles asc/desc. */
  col?: UserSort;
  sort?: UserSort;
  order?: 'asc' | 'desc';
  onSort?: (col: UserSort) => void;
}) {
  const active = col !== undefined && col === sort;
  const content = (
    <>
      <Text style={{ ...MONO_LABEL, color: active ? SNOW : MIST }}>{label}</Text>
      {active &&
        (order === 'asc' ? (
          <IconArrowUp size={12} stroke={2} color={CYAN} />
        ) : (
          <IconArrowDown size={12} stroke={2} color={CYAN} />
        ))}
    </>
  );
  const style = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    ...(grow ? { flex: 1, minWidth: 0 } : { width, flexShrink: 0 }),
  } as const;

  if (!col || !onSort) return <Box style={style}>{content}</Box>;
  return (
    <UnstyledButton onClick={() => onSort(col)} style={{ ...style, cursor: 'pointer' }}>
      {content}
    </UnstyledButton>
  );
}

/** Status pill: fully round, tinted fill, hairline of the same accent. */
