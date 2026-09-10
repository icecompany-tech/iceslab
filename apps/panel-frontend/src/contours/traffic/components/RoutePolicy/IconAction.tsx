import type { ReactNode } from 'react';
import { UnstyledButton } from '@mantine/core';
export function IconAction({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 32,
        borderRadius: 7,
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

/* ───── Icons ───────────────────────────────────────────────────────────── */
