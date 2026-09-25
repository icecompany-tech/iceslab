import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { modals } from '@mantine/modals';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconDownload,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconWorld,
} from '@tabler/icons-react';
import { apiErrorMessage } from '@/lib/net/client';
import {
  deleteMyRecipe,
  getRecipeRegistry,
  importRecipes,
  setHiddenRecipes,
  type RecipeRegistryAnswer,
} from '@/lib/domain/recipes';
import { recipeImportUrl } from '@/contours/profiles/lib/recipeImportUrl';
import {
  duplicateRecipeIds,
  fromWireRecipe,
  hiddenAfter,
  importSaved,
  isCuratedRecipe,
  recipeNotFound,
  splitHidden,
  recipeRailEmpty,
  recipesOnTile,
  recipeText,
  recipeTile,
  registryRepo,
  registryProblems,
  registrySkips,
  type Recipe,
  type RecipeProtocol,
  type RegistryProblem,
} from '@/contours/profiles/lib/recipes';

interface Props {
  /** The protocol tile (PROFILE_KINDS key) the built-ins are chosen by. */
  kindKey: string;
  /** How the tile is called on screen, for the empty state. */
  kindLabel: string;
  protocol: RecipeProtocol;
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
  return recipeText(recipe, (k) => i18n.exists(k), t);
}

export function RecipePicker({ kindKey, kindLabel, protocol, onPick }: Props) {
  const { t, i18n } = useTranslation();
  // Same lookup as useRecipeText, but callable inside a map.
  const copy = (r: Recipe) => {
    const text = recipeText(r, (k) => i18n.exists(k), t);
    return { title: text.name, subtitle: text.description };
  };
  const [picked, setPicked] = useState<Recipe | null>(null);
  const [importOpen, importCtl] = useDisclosure(false);
  const [search, setSearch] = useState('');

  // Community registry for this protocol. The backend already filters by
  // protocol, validates + version-gates every entry and caches for 6h, so
  // this is a cheap cached GET. Best-effort: errors surface as a line per
  // source that failed, never break the picker.
  const registryQuery = useQuery({
    queryKey: ['recipes', 'registry', protocol],
    queryFn: () => getRecipeRegistry({ protocol }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  // Every recipe comes from the registry answer (32b5719: the panel ships
  // none; its pinned snapshot is there as sourceId `builtin`, merged by the
  // server). A recipe lands on the tile its engine, protocol and subprotocol
  // say (recipesOnTile), the way a saved profile does. The snapshot's recipes
  // keep the compact rail on top; other sources and the operator's own go
  // below as cards. Hidden ones leave both and wait in «скрыто N».
  const onTile = useMemo(
    () => recipesOnTile((registryQuery.data?.recipes ?? []).map(fromWireRecipe), kindKey),
    [registryQuery.data, kindKey],
  );
  const hiddenIds = registryQuery.data?.hidden;
  const split = splitHidden(onTile, hiddenIds);
  // The rail holds the curated set: the snapshot, and the same recipes when
  // the official registry source wins the merge (it outranks the snapshot,
  // which then only shows in `alsoIn`; caught live on dev 25.09, the rail
  // stood empty). Community recipes and the operator's own go below.
  const builtins = split.shown.filter(isCuratedRecipe);
  const registry = split.shown.filter((r) => !isCuratedRecipe(r));
  // Hiding needs a server that has the field.
  const canHide = hiddenIds !== undefined;
  // The server merges duplicates itself: two recipes with one id are its bug.
  const dupes = duplicateRecipeIds(onTile);
  const stale = registryQuery.data?.stale ?? false;
  const problems = registryProblems(registryQuery.data);
  const skips = registrySkips(registryQuery.data);

  const handlePick = (r: Recipe) => {
    setPicked(r);
    onPick(r);
  };

  // Скрытые: полная замена списка; экран берёт список из ответа сервера (id,
  // который сервер отбросил, пропадает и с экрана). Список один на панель,
  // поэтому перечитываются все ответы реестра.
  const qc = useQueryClient();
  const hideMutation = useMutation({
    mutationFn: setHiddenRecipes,
    onSuccess: ({ hidden }) => {
      qc.setQueriesData<RecipeRegistryAnswer>({ queryKey: ['recipes', 'registry'] }, (old) =>
        old ? { ...old, hidden } : old,
      );
    },
    onError: (err) => notifications.show({ color: 'red', message: apiErrorMessage(err) }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteMyRecipe,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes', 'registry'] }),
    onError: (err) => {
      // 404: его уже нет (удалили из другой вкладки). Сказать и перечитать.
      if (recipeNotFound(err)) {
        notifications.show({ color: 'yellow', message: t('recipes.mine.alreadyGone') });
        void qc.invalidateQueries({ queryKey: ['recipes', 'registry'] });
        return;
      }
      notifications.show({ color: 'red', message: apiErrorMessage(err) });
    },
  });
  const confirmDelete = (r: Recipe) =>
    modals.openConfirmModal({
      title: t('recipes.mine.deleteTitle', { name: recipeText(r, (k) => i18n.exists(k), t).name }),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(r.id),
    });

  // The rail is always there (owner, 24.09): a tile with nothing to show
  // still offers Import and says why it is empty. «This tile has none» and
  // «the registry is not there» are different facts (recipeRailEmpty).
  const empty = recipeRailEmpty({
    loading: registryQuery.isLoading,
    failed: registryQuery.isError,
    stale,
    answered: registryQuery.data?.recipes.length ?? 0,
    shown: builtins.length + registry.length,
  });
  const repo = registryRepo(registryQuery.data?.source);

  const visibleBuiltins = builtins.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const c = copy(r);
    return `${c.title} ${c.subtitle}`.toLowerCase().includes(q);
  });

  return (
    <Stack gap="xs">
      {/* A rail, not a gallery: one line per recipe (name + what it is for),
          search on top, counts at the bottom. The star ratings moved into the
          row's own detail view; here they only competed with the titles. */}
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          {t('recipes.title')}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconDownload size={12} />}
          onClick={importCtl.open}
        >
          {t('recipes.import.button')}
        </Button>
      </Group>

      {/* Откуда рецепты и как добавить свой (владелец, 25.09): рецептов в
          коде панели нет, есть публичный реестр. */}
      <Text style={{ fontSize: 11, lineHeight: '15px', color: '#7A8BA3' }}>
        {t('recipes.fromRegistry')}{' '}
        <Anchor href={repo.url} target="_blank" rel="noreferrer" size="xs">
          {repo.name}
        </Anchor>
        {' · '}
        {t('recipes.proposeOwn')}{' '}
        <Anchor href={`${repo.url}/pulls`} target="_blank" rel="noreferrer" size="xs">
          pull request
        </Anchor>
      </Text>

      <TextInput
        size="xs"
        placeholder={t('recipes.searchPlaceholder')}
        leftSection={<IconSearch size={13} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />

      {visibleBuiltins.length > 0 && (
        <Stack gap={0} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1C2A3D' }}>
          {visibleBuiltins.map((r, i) => {
            const active = !!picked && recipeKey(picked) === recipeKey(r);
            const c = copy(r);
            return (
              <Box
                key={recipeKey(r)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  backgroundColor: active ? '#7DD3FC0F' : '#0B1420',
                  borderTop: i === 0 ? 'none' : '1px solid #1C2A3D',
                }}
              >
              <UnstyledButton
                onClick={() => handlePick(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}
              >
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: active ? '#7DD3FC' : '#C8D4E3',
                    }}
                  >
                    {c.title}
                  </Text>
                  <Text style={{ fontSize: 11, lineHeight: '15px', color: '#7A8BA3' }}>
                    {c.subtitle}
                  </Text>
                </Stack>
                {active && <IconCheck size={13} stroke={2.4} color="#7DD3FC" />}
              </UnstyledButton>
              {canHide && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => hideMutation.mutate(hiddenAfter(hiddenIds, r.id, 'hide'))}
                >
                  {t('recipes.hidden.hide')}
                </Button>
              )}
              </Box>
            );
          })}
        </Stack>
      )}

      {empty ? (
        <Text style={{ fontSize: 11, lineHeight: '15px', color: '#7A8BA3' }}>
          {empty === 'unavailable'
            ? t('recipes.registryUnavailable')
            : t('recipes.emptyForKind', { kind: kindLabel })}
        </Text>
      ) : (
        <Text style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 10, color: '#5A6B82' }}>
          {t('recipes.countLine', {
            shown: visibleBuiltins.length,
            total: builtins.length + registry.length,
          })}
        </Text>
      )}

      <RegistrySection
        recipes={registry}
        canHide={canHide}
        loading={registryQuery.isLoading}
        stale={stale}
        problems={problems}
        pickedKey={picked ? recipeKey(picked) : null}
        onPick={handlePick}
        onHide={(id) => hideMutation.mutate(hiddenAfter(hiddenIds, id, 'hide'))}
        onDelete={confirmDelete}
      />

      {/* Источник ответил, но часть рецептов пропущена: словами сервера,
          строка на пропуск (ca94cbb, problems у статуса источника). */}
      {skips.map((s) => (
        <Stack key={s.name} gap={2}>
          <Text size="xs" c="dimmed">
            {t('recipes.registry.skipped', { name: s.name, count: s.problems.length })}
          </Text>
          {s.problems.map((line) => (
            <Text key={line} size="10px" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
              {line}
            </Text>
          ))}
        </Stack>
      ))}
      {dupes.length > 0 && (
        <Text size="xs" c="red">
          {t('recipes.duplicates', { ids: dupes.join(', ') })}
        </Text>
      )}
      <HiddenRecipes recipes={split.hidden} onRestore={(id) => hideMutation.mutate(hiddenAfter(hiddenIds, id, 'show'))} />

      {picked && <AppliedAlert recipe={picked} />}

      <RecipeImportModal
        opened={importOpen}
        onClose={importCtl.close}
        kindKey={kindKey}
        kindLabel={kindLabel}
        onPick={handlePick}
      />
    </Stack>
  );
}

/**
 * Import: paste a link (a GitHub file page, a gist, a raw URL) or the recipe
 * JSON. The backend validates it against the same schema, then the operator
 * picks one to apply. With «Сохранить в панели» (on by default) the picked
 * one is also kept as the operator's own, badged «мой» on the rail.
 */
function RecipeImportModal({
  opened,
  onClose,
  kindKey,
  kindLabel,
  onPick,
}: {
  opened: boolean;
  onClose: () => void;
  /** The tile the form is on: only its recipes apply (recipeTile). */
  kindKey: string;
  kindLabel: string;
  onPick: (r: Recipe) => void;
}) {
  const { t, i18n } = useTranslation();
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

  // Страница GitHub или gist уходит raw-адресом того же файла (recipeImportUrl).
  const target = recipeImportUrl(url);
  // «Сохранить в панели» (контракт 25.09): по умолчанию включено. Сервер
  // сохраняет ровно один рецепт и файл с несколькими отвергает (ca94cbb), а
  // index реестра несёт их 22. Поэтому загрузка идёт без save, а сохраняется
  // тот рецепт, который оператор выбрал: второй запрос с ним одним.
  const [save, setSave] = useState(true);
  const [raw, setRaw] = useState<Map<string, unknown>>(new Map());
  const qc = useQueryClient();
  const saveMutation = useMutation({
    mutationFn: (wire: unknown) => importRecipes({ json: JSON.stringify(wire), save: true }),
    onSuccess: (data) => {
      const saved = importSaved(data.saved);
      if (!saved) return;
      const r = data.recipes.map(fromWireRecipe).find((x) => x.id === saved.id);
      const name = r ? recipeText(r, (k) => i18n.exists(k), t).name : saved.id;
      notifications.show({
        color: 'green',
        message: t(saved.replaced ? 'recipes.mine.replaced' : 'recipes.mine.saved', { name }),
      });
      void qc.invalidateQueries({ queryKey: ['recipes', 'registry'] });
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('recipes.mine.saveFailed'), message: apiErrorMessage(err) }),
  });
  const importMutation = useMutation({
    mutationFn: () => importRecipes(target.url ? { url: target.url } : { json: json.trim() }),
    onSuccess: (data) => {
      const all = data.recipes.map(fromWireRecipe);
      setRaw(new Map(data.recipes.map((w) => [w.id, w] as const)));
      // Only recipes of THIS tile apply here (recipeTile, as on the rail). A
      // protocol match is not enough: a Telegram SOCKS5 recipe is xray too,
      // and on the Xray tile it would turn the vless form into socks.
      const matched = all.filter((r) => recipeTile(r) === kindKey);
      setResults(matched);
      setHidden(all.length - matched.length);
      if (matched.length === 0) {
        notifications.show({
          color: 'yellow',
          message:
            all.length > 0
              ? t('recipes.import.wrongProtocol', { protocol: kindLabel })
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
          description={
            target.rewritten ? (
              <>
                {t('recipes.import.rewritten', { url: target.url })}
                {target.fromGistPage ? ` ${t('recipes.import.gistFirstFile')}` : ''}
              </>
            ) : undefined
          }
          inputWrapperOrder={['label', 'input', 'description', 'error']}
        />
        <Switch
          size="xs"
          checked={save}
          onChange={(e) => setSave(e.currentTarget.checked)}
          label={t('recipes.mine.saveLabel')}
          description={t('recipes.mine.saveHint')}
        />
        <Textarea
          label={t('recipes.import.jsonLabel')}
          placeholder='{ "schemaVersion": 2, "id": "...", "engine": "native", "protocol": "xray", "subprotocol": "vless", ... }'
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
                {t('recipes.import.hidden', { count: hidden, protocol: kindLabel })}
              </Text>
            )}
            {results.map((r) => {
              const text = recipeText(r, (k) => i18n.exists(k), t);
              return (
              <Paper
                key={recipeKey(r)}
                withBorder
                p="xs"
                radius="sm"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onPick(r);
                  // Сохраняется выбранный, одним рецептом (сервер берёт один).
                  const wire = raw.get(r.id);
                  if (save && wire) saveMutation.mutate(wire);
                  close();
                }}
              >
                <Group gap={8} wrap="nowrap">
                  <Text size="lg">{r.emoji}</Text>
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {text.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {text.description}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
              );
            })}
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
/**
 * «скрыт N, показать»: рецепты, которые оператор скрыл (hidden из ответа
 * реестра), с «Вернуть» у каждого в развороте. Ничего не скрыто: молчит.
 */
function HiddenRecipes({ recipes, onRestore }: { recipes: Recipe[]; onRestore: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  if (recipes.length === 0) return null;
  return (
    <Stack gap={4}>
      <UnstyledButton onClick={() => setOpen((v) => !v)}>
        <Text size="xs" c="dimmed">
          {t(open ? 'recipes.hidden.collapse' : 'recipes.hidden.expand', { count: recipes.length })}
        </Text>
      </UnstyledButton>
      {open &&
        recipes.map((r) => (
          <Group key={recipeKey(r)} gap={8} wrap="nowrap" justify="space-between">
            <Text size="xs" truncate>
              {r.emoji} {recipeText(r, (k) => i18n.exists(k), t).name}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => onRestore(r.id)}>
              {t('recipes.hidden.restore')}
            </Button>
          </Group>
        ))}
    </Stack>
  );
}

function RegistrySection({
  recipes,
  canHide,
  loading,
  stale,
  problems,
  pickedKey,
  onPick,
  onHide,
  onDelete,
}: {
  /** Рецепты не из снимка (источники оператора, свои), уже без скрытых. */
  recipes: Recipe[];
  /** Сервер знает поле hidden: у карточки есть «Скрыть». */
  canHide: boolean;
  loading: boolean;
  stale: boolean;
  /** Failed sources, one line each; null = the server does not say (old). */
  problems: RegistryProblem[] | null;
  pickedKey: string | null;
  onPick: (r: Recipe) => void;
  onHide: (id: string) => void;
  onDelete: (r: Recipe) => void;
}) {
  const { t } = useTranslation();
  const [region, setRegion] = useState<string>('ALL');

  // Region chips, only the regions actually present (plus "All"). A handful of
  // recipes: counted each render, no memo to keep in step with the split above.
  const regions = ['ALL', ...[...new Set(recipes.map((r) => r.region ?? 'GLOBAL'))].sort()];

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

  // Which source failed and why, a line each: «the repository is not there»
  // and «try later» ask for different things. A server without sources[]
  // keeps the one old line when its answer is stale.
  const problemLines =
    problems === null
      ? stale
        ? [t('recipes.registry.offline')]
        : []
      : problems.map((p) =>
          t(`recipes.registry.reason.${p.reason}`, { name: p.name, status: p.httpStatus ?? '' }),
        );
  const problemBlock =
    problemLines.length > 0 ? (
      <Stack gap={2}>
        {problemLines.map((line) => (
          <Text key={line} size="xs" c="dimmed">
            {line}
          </Text>
        ))}
      </Stack>
    ) : null;

  // Nothing beyond the snapshot: only why, if anything failed. The snapshot's
  // recipes already rendered above, so the picker still works.
  if (recipes.length === 0) return problemBlock;

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
            onHide={canHide && r.source !== 'mine' ? () => onHide(r.id) : undefined}
            onDelete={r.source === 'mine' ? () => onDelete(r) : undefined}
          />
        ))}
      </SimpleGrid>
      {problemBlock}
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
  onHide,
  onDelete,
}: {
  recipe: Recipe;
  active: boolean;
  onClick: () => void;
  /** «Скрыть»: у рецепта реестра, когда сервер умеет скрытые. */
  onHide?: () => void;
  /** «Удалить»: у своего рецепта. */
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const text = useRecipeText(recipe);
  const isRegistry = recipe.source === 'registry';
  const isMine = recipe.source === 'mine';
  const alsoIn = Array.isArray(recipe.alsoIn) ? recipe.alsoIn.filter((s) => typeof s === 'string') : [];
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
              {isMine && (
                <Badge size="xs" variant="light" color="cyan">
                  {t('recipes.mine.badge')}
                </Badge>
              )}
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
            {alsoIn.length > 0 && (
              <Text size="10px" c="dimmed" truncate>
                {t('recipes.alsoIn', { list: alsoIn.join(', ') })}
              </Text>
            )}
            {(onHide || onDelete) && (
              <Group gap={4} mt={2}>
                {onHide && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHide();
                    }}
                  >
                    {t('recipes.hidden.hide')}
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                )}
              </Group>
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
