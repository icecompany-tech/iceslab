import { useTranslation } from 'react-i18next';
import { Button, Code, CopyButton, Group, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import { getProfileRecipe } from '@/lib/domain/recipes';
import { registryRecipePath } from '@/contours/profiles/lib/recipes';

/**
 * «Экспортировать как рецепт» у сохранённого профиля (решение владельца
 * 25.09): рецепт собирает сервер (GET /api/profiles/:id/recipe), экран
 * показывает JSON, кнопку «Копировать» и куда его положить в форке реестра.
 * Ничего не сохраняется. Рецепт собран из СОХРАНЁННОГО профиля: правки в
 * форме, которые ещё не сохранены, в него не входят, и окно так и говорит.
 */
export function ProfileRecipeExportModal({
  opened,
  onClose,
  profileId,
}: {
  opened: boolean;
  onClose: () => void;
  profileId: string;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['profile-recipe', profileId],
    queryFn: () => getProfileRecipe(profileId),
    enabled: opened,
    retry: false,
    staleTime: 0,
  });
  const json = query.data ? JSON.stringify(query.data, null, 2) : '';

  return (
    <Modal opened={opened} onClose={onClose} title={t('recipes.export.title')} size="lg">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          {t('recipes.export.fromSaved')}
        </Text>

        {query.isLoading && <Loader size="xs" />}
        {query.isError && (
          <Text size="xs" c="red">
            {t('recipes.export.failed', { message: apiErrorMessage(query.error) })}
          </Text>
        )}

        {query.data && (
          <>
            <Text size="xs">
              {t('recipes.export.pathHint')}{' '}
              <Code>{registryRecipePath(query.data)}</Code>
            </Text>
            <ScrollArea.Autosize mah={360}>
              <Code block>{json}</Code>
            </ScrollArea.Autosize>
            <Text size="xs" c="dimmed">
              {t('recipes.export.ratingsHint')}
            </Text>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.close')}
          </Button>
          <CopyButton value={json}>
            {({ copied, copy }) => (
              <Button
                disabled={!query.data}
                leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                onClick={copy}
              >
                {copied ? t('recipes.export.copied') : t('recipes.export.copy')}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Modal>
  );
}
