import { IconDeviceDesktop, IconX } from '@tabler/icons-react';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { DISPLAY, HAIRLINE, MIST, MONO, RED, SNOW, SUNK, WELL } from '@/contours/users/lib/colors';
import { LABEL } from '@/contours/users/lib/userForm';
import { deleteHwidDevice, listUserDevices } from '@/lib/domain/users';
import { notifications } from '@mantine/notifications';
import { relativeTime } from '@/lib/ui/relativeTime';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
export function DeviceList({ userId, limit }: { userId: string; limit: number | '' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ['user-devices', userId],
    queryFn: () => listUserDevices(userId),
    staleTime: 30_000,
  });
  const resetMutation = useMutation({
    mutationFn: (id: string) => deleteHwidDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-devices', userId] });
      notifications.show({ color: 'green', message: t('userDrawer.deviceReset') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const devices = devicesQuery.data?.devices ?? [];
  const used = devices.length;
  const cap = limit === '' ? null : Number(limit);
  const full = cap !== null && cap > 0 && used >= cap;

  return (
    <Box
      style={{
        borderRadius: 8,
        border: `1px solid ${HAIRLINE}`,
        backgroundColor: SUNK,
        padding: '10px 12px',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: devices.length ? 8 : 0 }}>
        <IconDeviceDesktop size={13} stroke={1.8} color={full ? RED : MIST} />
        <Text style={{ ...LABEL, letterSpacing: '0.14em' }}>{t('userDrawer.devices')}</Text>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 10, color: full ? RED : MIST }}>
          {cap === null
            ? t('userDrawer.devicesCounterNoLimit', { used })
            : t('userDrawer.devicesCounter', { used, limit: cap })}
        </Text>
      </Box>

      {devicesQuery.isLoading && (
        <Text style={{ fontSize: 11, color: MIST }}>{t('common.loading')}</Text>
      )}
      {devicesQuery.isError && (
        <Text style={{ fontSize: 11, color: RED }}>{t('userDrawer.devicesError')}</Text>
      )}

      <Stack gap={5}>
        {devices.map((d) => (
          <Box
            key={d.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 9px',
              borderRadius: 6,
              backgroundColor: WELL,
            }}
          >
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: DISPLAY,
                fontSize: 12,
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              // The full hwid is what the client actually sent, and it is the
              // only way to tell two unlabelled devices apart.
              title={d.hwid}
            >
              {d.label ?? `${d.hwid.slice(0, 12)}…`}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: MIST, flexShrink: 0 }}>
              {relativeTime(d.lastSeenAt, t).text}
            </Text>
            <UnstyledButton
              onClick={() => resetMutation.mutate(d.id)}
              disabled={resetMutation.isPending}
              title={t('userDrawer.deviceResetHint')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: 5,
                border: `1px solid ${HAIRLINE}`,
                color: MIST,
                flexShrink: 0,
              }}
            >
              <IconX size={12} stroke={2.2} />
            </UnstyledButton>
          </Box>
        ))}
      </Stack>

      {!devicesQuery.isLoading && !devicesQuery.isError && devices.length === 0 && (
        // Empty is the normal starting state, not a fault: a device row appears
        // the first time a client sends its identifier, and never before.
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>
          {t('userDrawer.devicesEmpty')}
        </Text>
      )}
      {full && devices.length > 0 && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: RED, marginTop: 8 }}>
          {t('userDrawer.devicesFull')}
        </Text>
      )}
    </Box>
  );
}
