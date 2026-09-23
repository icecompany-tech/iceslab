import { useQueries, useQuery } from '@tanstack/react-query';
import { listBindings, listProfiles } from '@/lib/domain/profiles';
import { entryBystanders, type EntryBystander } from '@/contours/cascades/lib/cascadeForm';

/**
 * Чужие профили на входных нодах, с данными, которые экран каскада сам не грузит.
 *
 * Запросы ЛЕНИВЫЕ: пока вход не выбран или входных нод нет, не уходит ни один.
 * Профили берутся один раз на экран, привязки по каждой входной ноде
 * параллельно. Ключи кэша те же, что у остальных экранов: `['profiles']` и
 * `['bindings', nodeId]`, как на странице ноды (`useNodeEditForm`), так что
 * кэш у двух экранов общий, а правка профиля где угодно инвалидирует и эту
 * строку.
 *
 * Пока хоть один ответ не пришёл, результат `undefined`: частичный список
 * привязок сказал бы «чужих профилей нет» про ноду, которую мы ещё не видели.
 */
export function useEntryBystanders(
  entryProtocol: string | null | undefined,
  entryNodeIds: string[],
  nodeById: Map<string, { id: string; name: string; countryCode: string | null }>,
): EntryBystander[] | undefined {
  const ids = entryNodeIds.filter(Boolean);
  const active = Boolean(entryProtocol) && ids.length > 0;

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: active,
  });
  const bindingQueries = useQueries({
    queries: ids.map((nodeId) => ({
      queryKey: ['bindings', nodeId],
      queryFn: () => listBindings({ nodeId }),
      enabled: active,
    })),
  });

  if (!active) return undefined;
  const everyBinding = bindingQueries.every((q) => q.data);
  const bindings = everyBinding ? bindingQueries.flatMap((q) => q.data!.bindings) : undefined;
  const nodes = ids
    .map((id) => nodeById.get(id))
    .filter((n): n is { id: string; name: string; countryCode: string | null } => Boolean(n));
  return entryBystanders(entryProtocol, nodes, bindings, profilesQuery.data?.profiles);
}
