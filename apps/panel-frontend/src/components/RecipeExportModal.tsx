import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import type { ProtocolName } from '../lib/api';
import { buildExportRecipe, downloadRecipeJson } from '../lib/recipes';

/**
 * Export the current ProfileForm config as a shareable recipe JSON. The
 * operator fills in a name / ratings / region, and downloads a file they can
 * drop into their own GitHub recipe source. Captures only the protocol's own
 * fields as a static snapshot.
 */
export function RecipeExportModal({
  opened,
  onClose,
  protocol,
  values,
}: {
  opened: boolean;
  onClose: () => void;
  protocol: ProtocolName;
  values: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [region, setRegion] = useState('GLOBAL');
  const [dpi, setDpi] = useState<number>(4);
  const [speed, setSpeed] = useState<number>(4);

  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `${protocol}-custom`;

  function doExport() {
    const recipe = buildExportRecipe(protocol, values, {
      id: slug,
      name: name.trim() || slug,
      description: description.trim() || name.trim(),
      dpiResistance: dpi,
      speed,
      region,
    });
    downloadRecipeJson(recipe);
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('recipes.export.title')} size="md">
      <Stack>
        <Text size="xs" c="dimmed">
          {t('recipes.export.hint')}
        </Text>
        <TextInput
          label={t('recipes.export.nameLabel')}
          placeholder={t('recipes.export.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />
        <Textarea
          label={t('recipes.export.descLabel')}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={4}
        />
        <Group grow>
          <Select
            label={t('recipes.export.regionLabel')}
            data={['GLOBAL', 'RU', 'IR', 'CN', 'BY']}
            value={region}
            onChange={(v) => setRegion(v ?? 'GLOBAL')}
            allowDeselect={false}
          />
          <NumberInput
            label={t('recipes.dpiLabel')}
            min={1}
            max={5}
            value={dpi}
            onChange={(v) => setDpi(typeof v === 'number' ? v : 4)}
          />
          <NumberInput
            label={t('recipes.speedLabel')}
            min={1}
            max={5}
            value={speed}
            onChange={(v) => setSpeed(typeof v === 'number' ? v : 4)}
          />
        </Group>
        <Text size="10px" c="dimmed" ff="monospace">
          {t('recipes.export.filename', { name: slug })}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            leftSection={<IconDownload size={14} />}
            disabled={!name.trim()}
            onClick={doExport}
          >
            {t('recipes.export.download')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
