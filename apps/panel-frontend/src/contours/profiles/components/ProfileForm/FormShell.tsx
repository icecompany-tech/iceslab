import type { ReactNode } from 'react';
import { Box, Modal } from '@mantine/core';

/**
 * Either a modal or a plain section, with the same title block. Keeping one
 * shell means the form body below never has to know which one it is in.
 */
export function FormShell({
  inline,
  opened,
  onClose,
  title,
  size,
  children,
}: {
  inline?: boolean;
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: string;
  children: ReactNode;
}) {
  if (!inline) {
    return (
      <Modal opened={opened} onClose={onClose} title={title} size={size}>
        {children}
      </Modal>
    );
  }
  if (!opened) return null;
  // Inline mode drops the title block: the page it sits on already names the
  // profile in its own bar, and two identical headings read as a bug. The
  // class turns the form into a two-column grid, recipes on the right rail.
  return (
    <Box
      className="profile-form-inline"
      style={{
        padding: 20,
        borderRadius: 10,
        backgroundColor: '#0F1A28',
        border: '1px solid #1C2A3D',
      }}
    >
      {children}
    </Box>
  );
}
