import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isNotImplemented, listGeoSets, type GeoSet, type GeoSetKind } from '@/lib/domain/geoSets';

/**
 * Список гео-наборов для редакторов правил: имя -> набор и имя -> вид.
 *
 * Тот же ключ кэша, что у экрана наборов, поэтому десяток строк правил
 * спрашивает сервер один раз. Сервер без фазы 9 отвечает 404: карты пустые, и
 * подсказка молчит, а разбор строки идёт как раньше.
 */
export function useGeoSets(): { byName: ReadonlyMap<string, GeoSet>; kinds: ReadonlyMap<string, GeoSetKind> } {
  const q = useQuery({
    queryKey: ['geo-sets'],
    queryFn: listGeoSets,
    retry: (count, err) => !isNotImplemented(err) && count < 2,
    staleTime: 30_000,
  });
  return useMemo(() => {
    const sets = q.data?.geoSets ?? [];
    return {
      byName: new Map(sets.map((s) => [s.name, s] as const)),
      kinds: new Map(sets.map((s) => [s.name, s.kind] as const)),
    };
  }, [q.data]);
}
