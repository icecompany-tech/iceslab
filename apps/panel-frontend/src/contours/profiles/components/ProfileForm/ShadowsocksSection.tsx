import { useTranslation } from 'react-i18next';
import { Alert, Select, Stack, Text } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function ShadowsocksSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  const { t } = useTranslation();
  return (
            <Stack>
              <Select
                label={t('profiles.form.cfg.ssCipherLabel')}
                data={[
                  { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm (recommended)' },
                  { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                  { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
                  { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305 (legacy AEAD)' },
                  { value: 'aes-256-gcm', label: 'aes-256-gcm (legacy AEAD)' },
                  { value: 'aes-128-gcm', label: 'aes-128-gcm (legacy AEAD)' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('ssMethod')}
              />
              <Alert color="blue" variant="light">
                <Text size="sm">
                  {t('profiles.form.cfg.ssNote')}
                </Text>
              </Alert>
            </Stack>
  );
}
