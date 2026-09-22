import { Select, Stack, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { LINK_CONGESTIONS } from '@iceslab/shared';
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
              {/* Список берётся из контракта: движок у этого инбаунда и у ноги
                  каскада один, и значение, которого он не знает, роняет конфиг
                  при разборе. */}
              <Select
                label="Congestion control"
                data={[...LINK_CONGESTIONS]}
                allowDeselect={false}
                {...form.getInputProps('tuicCongestion')}
              />
            </Stack>
  );
}
