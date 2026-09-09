import { useTranslation } from 'react-i18next';
import { Alert, Stack, Text, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function MtprotoSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  const { t } = useTranslation();
  return (
            <Stack>
              <TextInput
                label={t('profiles.form.cfg.mtprotoDomain')}
                placeholder="www.cloudflare.com"
                required
                {...form.getInputProps('mtgDomain')}
              />
              <Alert color="yellow" variant="light">
                <Text size="sm">
                  {t('profiles.form.cfg.mtprotoDomainNote')}
                </Text>
              </Alert>
            </Stack>
  );
}
