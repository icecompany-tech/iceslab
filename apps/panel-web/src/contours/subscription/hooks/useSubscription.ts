import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings, getSubscriptionPreviewUrl, probeSubscriptionAddress, updateSettings, type UpdateSettingsInput } from '@/lib/old/settings'
import { createSrrRule, deleteSrrRule, listSrrRules, updateSrrRule, type CreateSrrInput, type UpdateSrrInput } from '@/lib/old/srr'
import { createTemplate, deleteTemplate, dryRunTemplate, importTemplate, isNotImplemented, listTemplates, restoreDefaultTemplate, updateTemplate, type TemplateType } from '@/lib/old/subscriptionTemplates'

export type PreviewState = 'active' | 'expiring' | 'expired' | 'limited' | 'disabled'

export const useSettings = () => useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings })

export function useSaveSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => updateSettings(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['settings'] })
      void client.invalidateQueries({ queryKey: ['subscription-preview'] })
    },
  })
}

export const useProbeAddress = () => useMutation({ mutationFn: probeSubscriptionAddress })

export const usePreviewUrl = (state: PreviewState, lang: 'ru' | 'en') => useQuery({ queryKey: ['subscription-preview', state, lang], queryFn: () => getSubscriptionPreviewUrl(state, lang) })

export const useRules = () => useQuery({ queryKey: ['srr'], queryFn: listSrrRules })

function useRulesRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: ['srr'] })
}

export function useSaveRule(id: string | null) {
  const refresh = useRulesRefresh()
  return useMutation({ mutationFn: (input: CreateSrrInput | UpdateSrrInput) => (id ? updateSrrRule(id, input) : createSrrRule(input as CreateSrrInput)), onSuccess: refresh })
}

export function useToggleRule() {
  const refresh = useRulesRefresh()
  return useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateSrrRule(id, { enabled }), onSettled: refresh })
}

export function useDeleteRule() {
  const refresh = useRulesRefresh()
  return useMutation({ mutationFn: (id: string) => deleteSrrRule(id), onSuccess: refresh })
}

/** A 404 is an answer, not a lost link: the server has no such route, asking again changes nothing. */
export const useTemplates = () => useQuery({ queryKey: ['subscription-templates'], queryFn: listTemplates, retry: (count, err) => !isNotImplemented(err) && count < 2 })

function useTemplatesRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: ['subscription-templates'] })
}

export const useImportTemplate = () => useMutation({ mutationFn: (body: string) => importTemplate({ body }) })
export const useDryRun = () => useMutation({ mutationFn: (input: { type: TemplateType; body: string }) => dryRunTemplate(input) })

export const runDryRun = dryRunTemplate

export function useSaveTemplate(id: string | null, type: TemplateType) {
  const refresh = useTemplatesRefresh()
  return useMutation({
    mutationFn: (input: { name?: string; body?: string; fullName: string; fullBody: string }) => (id ? updateTemplate(id, { ...(input.name === undefined ? {} : { name: input.name }), ...(input.body === undefined ? {} : { body: input.body }) }) : createTemplate({ type, name: input.fullName, body: input.fullBody })),
    onSuccess: refresh,
  })
}

export function useRestoreTemplate(id: string) {
  const refresh = useTemplatesRefresh()
  return useMutation({ mutationFn: () => restoreDefaultTemplate(id), onSuccess: refresh })
}

export function useDeleteTemplate(id: string) {
  const refresh = useTemplatesRefresh()
  return useMutation({ mutationFn: () => deleteTemplate(id), onSuccess: refresh })
}
