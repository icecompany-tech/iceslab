import { IconCheck } from '@tabler/icons-react';
import { BORDER_INPUT, CYAN, WELL } from '@/contours/users/lib/colors';
import { UnstyledButton } from '@mantine/core';

/** The tick in the row gutter. Square, 15px, the size the artboard draws. */
export function SelectBox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <UnstyledButton
      onClick={onChange}
      aria-checked={checked}
      role="checkbox"
      style={{
        width: 15,
        height: 15,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: checked ? `${CYAN}24` : WELL,
        border: `1px solid ${checked ? CYAN : BORDER_INPUT}`,
      }}
    >
      {checked && <IconCheck size={10} stroke={3} color={CYAN} />}
    </UnstyledButton>
  );
}
