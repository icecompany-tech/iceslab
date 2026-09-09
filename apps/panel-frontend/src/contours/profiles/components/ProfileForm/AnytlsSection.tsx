import { Stack, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function AnytlsSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  return (
            <Stack>
              <TextInput
                label="TLS serverName (SNI)"
                placeholder="www.bing.com"
                description="SNI the node's self-signed cert is issued for. AnyTLS is password-only (per-user password is auto-derived)."
                {...form.getInputProps('anytlsServerName')}
              />
            </Stack>
  );
}
