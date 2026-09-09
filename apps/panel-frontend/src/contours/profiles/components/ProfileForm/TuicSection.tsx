import { Select, Stack, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function TuicSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  return (
            <Stack>
              <TextInput
                label="TLS serverName (SNI)"
                placeholder="www.bing.com"
                description="SNI the node's self-signed cert is issued for. Clients connect with this name (allow-insecure for the alpha)."
                {...form.getInputProps('tuicServerName')}
              />
              <Select
                label="Congestion control"
                data={['bbr', 'cubic', 'new_reno']}
                allowDeselect={false}
                {...form.getInputProps('tuicCongestion')}
              />
            </Stack>
  );
}
