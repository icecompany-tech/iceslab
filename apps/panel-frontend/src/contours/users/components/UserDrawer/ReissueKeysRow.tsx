import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, Loader, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RED, FAINT, DISPLAY, SNOW } from '@/contours/users/lib/colors';
import { getUser, reissueUserCredentials, type User } from '@/lib/domain/users';
import { apiErrorMessage } from '@/lib/net/client';

/**
 * A-053: new keys for the user, in the danger zone of the card. Confirmed on
 * the card itself, in a sentence that says what it costs: every config and
 * the link handed out stop working on every device, and the person imports
 * the subscription again.
 *
 * The answer's shape is not read. On 2xx the lists and the drawer's link and
 * configs are read again: the users list, the user's delivery and endpoints,
 * and the user itself for the drawer (onReissued). A refusal is said in the
 * server's words under the row, where it was asked.
 */
export function ReissueKeysRow({ user, onReissued }: { user: User; onReissued?: (fresh: User) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => reissueUserCredentials(user.id),
    onSuccess: async () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['user-delivery', user.id] });
      void qc.invalidateQueries({ queryKey: ['user-endpoints', user.id] });
      notifications.show({ color: 'green', message: t('userDrawer.reissueDone') });
      // The drawer holds the user it was opened with; read it again so the
      // link it shows is the new one. A failed read leaves the old object, and
      // the list behind it is already being read again.
      const fresh = await getUser(user.id).catch(() => null);
      if (fresh) onReissued?.(fresh);
    },
  });

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '11px 12px',
        borderRadius: 8,
        border: `1px solid ${RED}33`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
            {t('userDrawer.reissueTitle')}
          </Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
            {t('userDrawer.reissueBody')}
          </Text>
        </Box>
        {!confirming && (
          <ActionButton
            label={t('userDrawer.reissueAction')}
            onClick={() => {
              mutation.reset();
              setConfirming(true);
            }}
          />
        )}
      </Box>
      {confirming && (
        <Box style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          <Text style={{ flex: 1, minWidth: 0, fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: RED }}>
            {t('userDrawer.reissueConfirm')}
          </Text>
          <ActionButton
            label={mutation.isPending ? <Loader size={12} color={RED} /> : t('userDrawer.reissueConfirmAction')}
            filled
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          />
          <ActionButton label={t('common.cancel')} muted disabled={mutation.isPending} onClick={() => setConfirming(false)} />
        </Box>
      )}
      {mutation.isError && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: RED }}>
          {apiErrorMessage(mutation.error)}
        </Text>
      )}
    </Box>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  filled,
  muted,
}: {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  filled?: boolean;
  muted?: boolean;
}) {
  const color = muted ? FAINT : RED;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        height: 30,
        paddingInline: 14,
        borderRadius: 7,
        border: `1px solid ${color}55`,
        backgroundColor: filled ? `${RED}1F` : 'transparent',
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, color }}>{label}</Text>
    </UnstyledButton>
  );
}
