import { useQuery } from '@tanstack/react-query';
import { getPublicSettings } from '@/lib/net/api';

export function useBrandName(): string {
  const { data } = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: getPublicSettings,
    staleTime: 5 * 60 * 1000,
  });
  return data?.brandName ?? 'Iceslab';
}
