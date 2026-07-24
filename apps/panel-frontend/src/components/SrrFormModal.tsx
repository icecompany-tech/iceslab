import { Button, Modal, NumberInput, Select, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  type CreateSrrInput,
  type SrrRule,
  type SubscriptionFormat,
  type UpdateSrrInput,
} from '../lib/api';

const FORMAT_OPTIONS: { value: SubscriptionFormat; label: string }[] = [
  { value: 'plain', label: 'Plain (base64 URI list)' },
  { value: 'json', label: 'JSON (Iceslab structured)' },
  { value: 'clash', label: 'Clash YAML' },
  { value: 'singbox', label: 'Sing-box JSON' },
  { value: 'wgconf', label: 'wg-quick conf (AmneziaWG)' },
  { value: 'xrayjson', label: 'Xray JSON (single config)' },
  { value: 'xrayjson-array', label: 'Xray JSON array (Happ / V2RayTun)' },
  { value: 'xkeen', label: 'XKeen (Keenetic router)' },
  { value: 'outline', label: 'Outline / SIP008 (Shadowsocks)' },
  { value: 'surge', label: 'Surge' },
  { value: 'quantumultx', label: 'Quantumult X' },
  { value: 'loon', label: 'Loon' },
];

interface FormValues {
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority: number | '';
  enabled: boolean;
}

function defaultValues(rule: SrrRule | null): FormValues {
  return {
    name: rule?.name ?? '',
    uaPattern: rule?.uaPattern ?? '',
    format: rule?.format ?? 'plain',
    priority: rule?.priority ?? 100,
    enabled: rule?.enabled ?? true,
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  rule: SrrRule | null;
  onSubmit: (input: CreateSrrInput | UpdateSrrInput) => Promise<void>;
  loading?: boolean;
}

export function SrrFormModal({ opened, onClose, rule, onSubmit, loading }: Props) {
  const isEdit = rule !== null;

  const form = useForm<FormValues>({
    initialValues: defaultValues(rule),
    validate: {
      name: (v) => (v.length < 1 ? 'Required' : null),
      uaPattern: (v) => {
        if (v.length < 1) return 'Required';
        // Mirror server-side: try to compile (ignore inline-flag prefix)
        const m = v.match(/^\(\?([imsux]+)\)([\s\S]*)$/);
        try {
          if (m) new RegExp(m[2]!, m[1]!.replace(/[^ims]/g, ''));
          else new RegExp(v);
          return null;
        } catch (err) {
          return `Invalid regex: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  });

  if (opened && rule !== null && form.values.name === '' && form.values.uaPattern === '') {
    form.setValues(defaultValues(rule));
  }

  async function handleSubmit(values: FormValues) {
    const payload = {
      name: values.name,
      uaPattern: values.uaPattern,
      format: values.format,
      priority: values.priority === '' ? undefined : Number(values.priority),
      enabled: values.enabled,
    };
    await onSubmit(payload);
    onClose();
    form.reset();
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={isEdit ? `Edit "${rule.name}"` : 'Create rule'}
      size="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label="Name"
            placeholder="Hiddify"
            required
            {...form.getInputProps('name')}
          />
          <TextInput
            label="User-Agent regex"
            placeholder="Hiddify|HiddifyNext"
            description="Tip: prefix with (?i) for case-insensitive match"
            required
            {...form.getInputProps('uaPattern')}
          />
          <Select
            label="Format"
            data={FORMAT_OPTIONS}
            allowDeselect={false}
            {...form.getInputProps('format')}
          />
          <NumberInput
            label="Priority"
            description="Lower runs first; default catch-all is 900"
            min={0}
            max={10000}
            allowDecimal={false}
            allowNegative={false}
            {...form.getInputProps('priority')}
          />
          <Switch
            label="Enabled"
            checked={form.values.enabled}
            onChange={(e) => form.setFieldValue('enabled', e.currentTarget.checked)}
          />
          <Button type="submit" loading={loading} fullWidth>
            {isEdit ? 'Save changes' : 'Create rule'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
