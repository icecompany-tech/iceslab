import { useQuery } from '@tanstack/react-query'
import { listHosts } from '@/lib/old/hosts'
import { listBindings } from '@/lib/old/profiles'

export const useHostsList = () => useQuery({ queryKey: ['hosts', 'all'], queryFn: () => listHosts(), refetchInterval: 30_000 })
export const useBindingsList = () => useQuery({ queryKey: ['bindings', 'all'], queryFn: () => listBindings() })
