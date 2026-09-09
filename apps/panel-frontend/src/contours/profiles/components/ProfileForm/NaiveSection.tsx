import { useTranslation } from 'react-i18next';
import { Stack, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function NaiveSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  const { t } = useTranslation();
  return (
            <Stack>
              <TextInput
                label={t('profiles.form.cfg.naiveHostnameLabel')}
                placeholder="n1.example.com"
                required
                {...form.getInputProps('naiveHostname')}
              />
              <TextInput
                label={t('profiles.form.cfg.naiveTlsEmailLabel')}
                placeholder="ops@example.com"
                required
                {...form.getInputProps('naiveTlsEmail')}
              />
              <TextInput
                label={t('profiles.form.cfg.naiveMasqueradeLabel')}
                placeholder="/var/www/html"
                {...form.getInputProps('naiveMasquerade')}
              />
            </Stack>
  );
}
