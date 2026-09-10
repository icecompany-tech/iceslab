import { CARD } from '@/contours/users/lib/colors';
import { DrawerBody } from '@/contours/users/components/UserDrawer/DrawerBody';
import { DrawerFooter } from '@/contours/users/components/UserDrawer/DrawerFooter';
import { DrawerHeader } from '@/contours/users/components/UserDrawer/DrawerHeader';
import { useUserForm } from '@/contours/users/components/UserDrawer/useUserForm';
import { Drawer } from '@mantine/core';
import { type CreateUserInput, type UpdateUserInput, type User } from '@/lib/domain/users';

/**
 * Create / edit a user. A drawer rather than a modal: this is a form you fill
 * while still reading the roster behind it, and it is long enough that a
 * centred modal would fight the page for vertical space.
 *
 * The shape follows one idea: the operator answers three questions at the top
 * (which preset, what name, which squads) and immediately sees what that
 * produces in "What the client gets". Everything else is folded into Advanced,
 * because on most days it is left alone.
 */

export interface Props {
  opened: boolean;
  onClose: () => void;
  user: User | null;
  onSubmit: (input: CreateUserInput | UpdateUserInput) => Promise<void>;
  loading?: boolean;
}

export function UserDrawer({ opened, onClose, user, onSubmit, loading }: Props) {
  const {
    isEdit,
    presets,
    form,
    squads,
    nameTaken,
    nameFree,
    preview,
    applyPreset,
    toggleSquad,
    handleSubmit,
    expiresAt,
    advancedOpen,
    setAdvancedOpen,
    presetId,
  } = useUserForm({ opened, user, onSubmit, onClose });

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={540}
      withCloseButton={false}
      padding={0}
      overlayProps={{ backgroundOpacity: 0.55, color: '#030810' }}
      styles={{ content: { backgroundColor: CARD, display: 'flex', flexDirection: 'column' } }}
    >
      <form
        onSubmit={form.onSubmit(handleSubmit)}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <DrawerHeader isEdit={isEdit} onClose={onClose} user={user} />

        <DrawerBody isEdit={isEdit} presets={presets} form={form} squads={squads} nameTaken={nameTaken} nameFree={nameFree} preview={preview} applyPreset={applyPreset} toggleSquad={toggleSquad} expiresAt={expiresAt} advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} presetId={presetId} user={user} />

        <DrawerFooter isEdit={isEdit} onClose={onClose} loading={loading} />
      </form>
    </Drawer>
  );
}

