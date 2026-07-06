import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconDownload,
  IconStar,
  IconStarFilled,
  IconWorld,
} from '@tabler/icons-react';
import type { ProtocolName } from '../lib/api';
import { apiErrorMessage, getRecipeRegistry, importRecipes } from '../lib/api';
import { fromWireRecipe, recipesForProtocol, type Recipe } from '../lib/recipes';

interface Props {
  protocol: ProtocolName;
  onPick: (recipe: Recipe) => void;
}

/**
 * Stable identity across sources: two different sources can legitimately
 * ship a recipe with the same `id`, so key and selection compare on
 * sourceId:id (built-ins have no source and fall back to id).
 */
function recipeKey(r: Recipe): string {
  return r.sourceId ? `${r.sourceId}:${r.id}` : r.id;
}

/**
 * Recipe gallery shown above the protocol-specific config block in
 * ProfileFormModal. One click pre-fills a known-good combo so admins
 * don't need to reason about REALITY/Vision/transport compatibility
 * matrices themselves.
 *
 * Two sources, one card path: built-in recipes (lib/recipes.ts) and the
 * community registry pulled from GitHub via the backend proxy. A registry
 * recipe is data, not code, it only sets ProfileForm field values, which
 * the form then validates on save. The registry is best-effort: if it is
 * unreachable the built-ins still work and we show an offline hint.
 *
 * The chosen recipe stays highlighted but doesn't lock the form, admins
 * can still tweak individual fields after applying.
 */

/**
 * Resolve a recipe's user-visible text from the i18n bundle, falling
 * back to the recipe's own value if there's no translation key. Built-ins
 * are authored in russian in recipes.ts and overridden per id by en.ts;
 * registry recipes carry their own text and have no keys, so they always
 * fall back to what the registry shipped.
 */
function useRecipeText(recipe: Recipe) {
  const { t, i18n } = useTranslation();
  const base = `recipes.cards.${recipe.id}`;
  const has = (suffix: string) => i18n.exists(`${base}.${suffix}`);
  return {
    name: has('name') ? t(`${base}.name`) : recipe.name,
    description: has('description')
      ? t(`${base}.description`)
      : recipe.description,
    details: has('details') ? t(`${base}.details`) : recipe.details,
    notes: has('notes')
      ? (t(`${base}.notes`, { returnObjects: true }) as unknown as string[])
      : recipe.notes,
  };
}

export function RecipePicker({ protocol, onPick }: Props) {
  const { t } = useTranslation();
  const builtins = recipesForProtocol(protocol);
  const [picked, setPicked] = useState<Recipe | null>(null);
  const [importOpen, importCtl] = useDisclosure(false);

  // Community registry for this protocol. The backend already filters by
  // protocol, validates + version-gates every entry and caches for 6h, so
  // this is a cheap cached GET. Best-effort: errors surface as an offline
  // hint, never break the picker.
  const registryQuery = useQuery({
    queryKey: ['recipes', 'registry', protocol],
    queryFn: () => getRecipeRegistry({ protocol }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const registry = useMemo(
    () => (registryQuery.data?.recipes ?? []).map(fromWireRecipe),
    [registryQuery.data],
  );
  const stale = registryQuery.data?.stale ?? false;

  const handlePick = (r: Recipe) => {
    setPicked(r);
    onPick(r);
  };

  // Nothing to offer for this protocol (no built-ins, empty registry, done
  // loading): render nothing so the form doesn't grow an empty header.
  if (
    builtins.length === 0 &&
    registry.length === 0 &&
    !registryQuery.isLoading
  ) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <Stack gap={0}>
          <Text fw={600} size="sm">
            {t('recipes.title')}
          </Text>
          <Text size="xs" c="dimmed">
            {t('recipes.subtitle')}
          </Text>
        </Stack>
        <Group gap="xs">
          {picked && (
            <Badge variant="light" color="teal" leftSection={<IconCheck size={11} />}>
              {t('recipes.appliedBadge')}
            </Badge>
          )}
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconDownload size={12} />}
            onClick={importCtl.open}
          >
            {t('recipes.import.button')}
          </Button>
        </Group>
      </Group>

      {builtins.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
          {builtins.map((r) => (
            <RecipeCard
              key={recipeKey(r)}
              recipe={r}
              active={!!picked && recipeKey(picked) === recipeKey(r)}
              onClick={() => handlePick(r)}
            />
          ))}
        </SimpleGrid>
      )}

      <RegistrySection
        recipes={registry}
        loading={registryQuery.isLoading}
        stale={stale}
        pickedKey={picked ? recipeKey(picked) : null}
        onPick={handlePick}
      />

      {picked && <AppliedAlert recipe={picked} />}

      <RecipeImportModal
        opened={importOpen}
        onClose={importCtl.close}
        protocol={protocol}
        onPick={handlePick}
      />
    </Stack>
  );
}

/**
 * Ad-hoc import: paste a raw URL (your gist / GitHub) or the recipe JSON
 * directly. The backend validates it against the same schema, then the
 * operator picks one to apply. Nothing is persisted; this is a one-off.
 */
function RecipeImportModal({
  opened,
  onClose,
  protocol,
  onPick,
}: {
  opened: boolean;
  onClose: () => void;
  protocol: ProtocolName;
  onPick: (r: Recipe) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [json, setJson] = useState('');
  const [results, setResults] = useState<Recipe[] | null>(null);
  const [hidden, setHidden] = useState(0);

  const reset = () => {
    setUrl('');
    setJson('');
    setResults(null);
    setHidden(0);
  };
  const close = () => {
    reset();
    onClose();
  };

  const importMutation = useMutation({
    mutationFn: () =>
      importRecipes(url.trim() ? { url: url.trim() } : { json: json.trim() }),
    onSuccess: (data) => {
      const all = data.recipes.map(fromWireRecipe);
      // A profile has one fixed protocol; only recipes for the protocol being
      // configured can apply here. Hide the rest (e.g. an xray recipe while on
      // hysteria) so they cannot be merged into the wrong form.
      const matched = all.filter((r) => r.protocol === protocol);
      setResults(matched);
      setHidden(all.length - matched.length);
      if (matched.length === 0) {
        notifications.show({
          color: 'yellow',
          message:
            all.length > 0
              ? t('recipes.import.wrongProtocol', { protocol })
              : t('recipes.import.none'),
        });
      }
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('recipes.import.failed'),
        message: apiErrorMessage(err),
      }),
  });

  return (
    <Modal opened={opened} onClose={close} title={t('recipes.import.title')} size="lg">
      <Stack>
        <Text size="xs" c="dimmed">
          {t('recipes.import.hint')}
        </Text>
        <TextInput
          label={t('recipes.import.urlLabel')}
          placeholder="https://raw.githubusercontent.com/you/recipes/main/xray-my.json"
          value={url}
          onChange={(e) => {
            setUrl(e.currentTarget.value);
            setResults(null);
          }}
        />
        <Textarea
          label={t('recipes.import.jsonLabel')}
          placeholder='{ "schemaVersion": 1, "id": "...", "protocol": "xray", ... }'
          autosize
          minRows={3}
          maxRows={10}
          value={json}
          onChange={(e) => {
            setJson(e.currentTarget.value);
            setResults(null);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={importMutation.isPending}
            disabled={!url.trim() && !json.trim()}
            onClick={() => importMutation.mutate()}
          >
            {t('recipes.import.load')}
          </Button>
        </Group>

        {results && results.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={600}>
              {t('recipes.import.pick')}
            </Text>
            {hidden > 0 && (
              <Text size="xs" c="dimmed">
                {t('recipes.import.hidden', { count: hidden, protocol })}
              </Text>
            )}
            {results.map((r) => (
              <Paper
                key={recipeKey(r)}
                withBorder
                p="xs"
                radius="sm"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onPick(r);
                  close();
                }}
              >
                <Group gap={8} wrap="nowrap">
                  <Text size="lg">{r.emoji}</Text>
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {r.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {r.description}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * Community-registry section: region filter + validated recipe cards from
 * GitHub. Collapses to a single offline hint on failure and renders nothing
 * while there is genuinely nothing to show.
 */
function RegistrySection({
  recipes,
  loading,
  stale,
  pickedKey,
  onPick,
}: {
  recipes: Recipe[];
  loading: boolean;
  stale: boolean;
  pickedKey: string | null;
  onPick: (r: Recipe) => void;
}) {
  const { t } = useTranslation();
  const [region, setRegion] = useState<string>('ALL');

  // Region chips, only the regions actually present (plus "All").
  const regions = useMemo(() => {
    const present = new Set(recipes.map((r) => r.region ?? 'GLOBAL'));
    return ['ALL', ...[...present].sort()];
  }, [recipes]);

  const shown =
    region === 'ALL'
      ? recipes
      : recipes.filter((r) => (r.region ?? 'GLOBAL') === region);

  if (loading) {
    return (
      <Group gap={8} py={4}>
        <Loader size="xs" />
        <Text size="xs" c="dimmed">
          {t('recipes.registry.loading')}
        </Text>
      </Group>
    );
  }

  // Registry offline and nothing cached: a quiet one-liner, built-ins already
  // rendered above so the picker still works.
  if (recipes.length === 0) {
    if (stale) {
      return (
        <Text size="xs" c="dimmed">
          {t('recipes.registry.offline')}
        </Text>
      );
    }
    return null;
  }

  return (
    <Stack gap={6} mt={4}>
      <Group justify="space-between" align="center">
        <Group gap={6}>
          <IconWorld size={13} style={{ color: 'var(--mantine-color-dimmed)' }} />
          <Text fw={600} size="xs">
            {t('recipes.registry.title')}
          </Text>
          {stale && (
            <Tooltip label={t('recipes.registry.offline')}>
              <Badge size="xs" variant="light" color="gray">
                {t('recipes.registry.staleBadge')}
              </Badge>
            </Tooltip>
          )}
        </Group>
        {regions.length > 2 && (
          <SegmentedControl
            size="xs"
            value={region}
            onChange={setRegion}
            data={regions.map((r) => ({
              value: r,
              label:
                r === 'ALL'
                  ? t('recipes.registry.regionAll')
                  : t(`recipes.registry.region.${r}`, { defaultValue: r }),
            }))}
          />
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
        {shown.map((r) => (
          <RecipeCard
            key={recipeKey(r)}
            recipe={r}
            active={pickedKey === recipeKey(r)}
            onClick={() => onPick(r)}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function AppliedAlert({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const text = useRecipeText(recipe);
  return (
    <Alert color="teal" variant="light" icon={<IconCheck size={16} />}>
      <Stack gap={4}>
        <Text size="xs" fw={500}>
          {t('recipes.appliedAlert', { name: text.name })}
        </Text>
        {text.notes?.map((n, i) => (
          <Text key={i} size="xs">
            • {n}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}

function RecipeCard({
  recipe,
  active,
  onClick,
}: {
  recipe: Recipe;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const text = useRecipeText(recipe);
  const isRegistry = recipe.source === 'registry';
  return (
    <Tooltip label={text.details} multiline w={320} withArrow openDelay={400}>
      <Card
        withBorder
        p="sm"
        radius="sm"
        style={{
          cursor: 'pointer',
          borderColor: active ? 'var(--mantine-color-teal-6)' : undefined,
          backgroundColor: active
            ? 'var(--mantine-color-teal-light)'
            : undefined,
        }}
        onClick={onClick}
      >
        <Group gap={6} align="flex-start" wrap="nowrap">
          <Text size="xl" lh={1}>
            {recipe.emoji}
          </Text>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap="nowrap" justify="space-between">
              <Text fw={600} size="sm" lh={1.2}>
                {text.name}
              </Text>
              {isRegistry && (
                <Badge
                  size="xs"
                  variant="light"
                  color={recipe.verified ? 'teal' : 'grape'}
                >
                  {recipe.verified
                    ? t('recipes.registry.official')
                    : t('recipes.registry.community')}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {text.description}
            </Text>
            <Group gap={6} mt={4}>
              <StarRating
                label={t('recipes.dpiLabel')}
                value={recipe.dpiResistance}
                color="violet"
              />
              <StarRating
                label={t('recipes.speedLabel')}
                value={recipe.speed}
                color="orange"
              />
            </Group>
            {isRegistry && (recipe.sourceName || recipe.author) && (
              <Text size="10px" c="dimmed" truncate>
                {[
                  recipe.sourceName,
                  recipe.author
                    ? t('recipes.registry.byAuthor', { author: recipe.author })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
          </Stack>
        </Group>
      </Card>
    </Tooltip>
  );
}

function StarRating({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Group gap={1}>
      <Text size="xs" c="dimmed" fw={500} mr={2}>
        {label}
      </Text>
      {[1, 2, 3, 4, 5].map((i) =>
        i <= value ? (
          <IconStarFilled
            key={i}
            size={9}
            style={{ color: `var(--mantine-color-${color}-6)` }}
          />
        ) : (
          <IconStar key={i} size={9} style={{ color: 'var(--mantine-color-gray-5)' }} />
        ),
      )}
    </Group>
  );
}
