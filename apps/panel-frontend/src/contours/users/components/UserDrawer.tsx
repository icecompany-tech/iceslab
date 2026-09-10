import { DrawerBody } from '@/contours/users/components/UserDrawer/DrawerBody';
import { DrawerFooter } from '@/contours/users/components/UserDrawer/DrawerFooter';
import { DrawerHeader } from '@/contours/users/components/UserDrawer/DrawerHeader';
import { HAIRLINE, WELL } from '@/contours/users/lib/colors';
import { Modal } from '@mantine/core';
import { useUserForm } from '@/contours/users/components/UserDrawer/useUserForm';
import { type CreateUserInput, type UpdateUserInput, type User } from '@/lib/domain/users';

/**
 * Create / edit a user. A modal in two columns: the form on the left, what the
 * client ends up with on the right, so the answer sits next to the question
 * instead of below it.
 *
 * It was a 540px drawer, and the width was the problem: the preview had to
 * queue behind the fields, which pushed traffic and expiry into Advanced to
 * keep the column short. Two columns give the preview its own lane and let the
 * three things an operator sets every time stay in the open.
 *
 * The modal never grows the page: it caps at the viewport and scrolls inside.
 */

export interface Props {
  opened: boolean;
  onClose: () => void;
  user: User | null;
  onSubmit: (input: CreateUserInput | UpdateUserInput) => Promise<void>;
  loading?: boolean;
}

export function UserDrawer({ opened, onClose, user, onSubmit, loading }: Props) {
  const ui = useUserForm({ opened, user, onSubmit, onClose });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size={820}
      withCloseButton={false}
      padding={0}
      radius={14}
      overlayProps={{ backgroundOpacity: 0.55, color: '#030810' }}
      styles={{
        inner: { padding: 24 },
        content: {
          backgroundColor: WELL,
          border: `1px solid ${HAIRLINE}`,
          boxShadow: '0 32px 80px #000000B3',
          display: 'flex',
          flexDirection: 'column',
          // Height comes from the window, not from the form: on a short screen
          // the body scrolls and header and footer stay put.
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'hidden',
        },
        body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
      }}
    >
      <form
        onSubmit={ui.form.onSubmit(ui.handleSubmit)}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <DrawerHeader isEdit={ui.isEdit} onClose={onClose} user={user} />
        <DrawerBody {...ui} user={user} />
        <DrawerFooter isEdit={ui.isEdit} onClose={onClose} loading={loading} />
      </form>
    </Modal>
  );
}
