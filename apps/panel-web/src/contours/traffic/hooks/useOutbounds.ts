import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createNamedOutbound, deleteNamedOutbound, listNamedOutbounds, updateNamedOutbound, type CreateNamedOutboundInput, type UpdateNamedOutboundInput } from '@/lib/old/namedOutbounds'

const KEY = ['named-outbounds']

export const useOutbounds = () => useQuery({ queryKey: KEY, queryFn: listNamedOutbounds })

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: KEY })
}

export function useCreateOutbound() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: CreateNamedOutboundInput) => createNamedOutbound(input), onSuccess: refresh })
}

export function useUpdateOutbound(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (input: UpdateNamedOutboundInput) => updateNamedOutbound(id, input), onSuccess: refresh })
}

/** A refusal rereads too: the list said it was free, the server knew better. */
export function useDeleteOutbound() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: string) => deleteNamedOutbound(id), onSettled: refresh })
}
