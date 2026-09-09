import { NumberInput, Stack } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

export function MieruSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  return (
            <Stack>
              <NumberInput
                label="MTU"
                placeholder="1400"
                min={576}
                max={1500}
                {...form.getInputProps('mieruMtu')}
              />
            </Stack>
  );
}
