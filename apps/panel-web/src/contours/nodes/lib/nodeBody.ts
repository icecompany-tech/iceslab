// What a save of a node sends: only what changed (F-K3). The old server rewrites and pushes the
// node on some of these, so an untouched field must not travel.
import { maxUsersPatch, multiplierPatch, multiplierInput, parseMaxUsers, parseMultiplier } from '@/contours/nodes/lib/nodeLimits'
import { domainOk, domainPatch } from '@/contours/nodes/lib/nodeEditForm'
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols'
import type { NodeCoreVersions } from '@iceslab/shared'
import { coreVersionsPatch } from '@/lib/old/coreVersions'
import type { Node, UpdateNodeInput } from '@/lib/old/nodes'

export interface NodeDraft {
  name: string
  host: string
  port: string
  countryCode: string
  regionId: string
  domain: string
  multiplier: string
  maxUsers: string
  policyId: string
  /** No component = the manifest pin. Only the difference from the stored one is sent. */
  coreVersions: NodeCoreVersions
}

function splitAddress(address: string): { host: string; port: string } {
  const at = address.lastIndexOf(':')
  return at === -1 ? { host: address, port: String(DEFAULT_NODE_PORT) } : { host: address.slice(0, at), port: address.slice(at + 1) }
}

export function draftOfNode(node: Node): NodeDraft {
  const { host, port } = splitAddress(node.address)
  return {
    name: node.name,
    host,
    port,
    countryCode: node.countryCode ?? '',
    regionId: node.regionId ?? '',
    domain: node.domain ?? '',
    multiplier: multiplierInput(node.consumptionMultiplier, true),
    maxUsers: node.maxUsers === null ? '' : String(node.maxUsers),
    policyId: node.policyId ?? '',
    coreVersions: { ...(node.coreVersions ?? {}) },
  }
}

export const addressOf = (draft: Pick<NodeDraft, 'host' | 'port'>) => `${draft.host.trim()}:${draft.port.trim() || DEFAULT_NODE_PORT}`

export function nodeUpdateBody(initial: NodeDraft, draft: NodeDraft, stored: Pick<Node, 'domain' | 'coreVersions'>): UpdateNodeInput {
  const body: UpdateNodeInput = {}
  if (draft.name.trim() !== initial.name) body.name = draft.name.trim()
  if (addressOf(draft) !== addressOf(initial)) body.address = addressOf(draft)
  if (draft.countryCode !== initial.countryCode) body.countryCode = draft.countryCode || null
  if (draft.regionId !== initial.regionId) body.regionId = draft.regionId || null
  if (draft.domain !== initial.domain) Object.assign(body, domainPatch(stored.domain, draft.domain))
  if (draft.multiplier !== initial.multiplier) Object.assign(body, multiplierPatch(draft.multiplier, true))
  if (draft.maxUsers !== initial.maxUsers) Object.assign(body, maxUsersPatch(draft.maxUsers))
  // A real action, not a no-op: null rewrites the node's config without the rules.
  if (draft.policyId !== initial.policyId) body.policyId = draft.policyId || null
  // A server with no `coreVersions` on the node would refuse the key: nothing goes then.
  const versions = stored.coreVersions === undefined ? undefined : coreVersionsPatch(initial.coreVersions, draft.coreVersions)
  if (versions) body.coreVersions = versions
  return body
}

export function draftErrors(draft: NodeDraft): { name?: true; host?: true; port?: true; domain?: true; multiplier?: true; maxUsers?: true } {
  const port = Number(draft.port)
  return {
    ...(draft.name.trim() === '' ? { name: true as const } : {}),
    ...(draft.host.trim() === '' ? { host: true as const } : {}),
    ...(draft.port.trim() !== '' && (!Number.isInteger(port) || port < 1 || port > 65535) ? { port: true as const } : {}),
    ...(domainOk(draft.domain) ? {} : { domain: true as const }),
    ...(parseMultiplier(draft.multiplier).ok ? {} : { multiplier: true as const }),
    ...(parseMaxUsers(draft.maxUsers).ok ? {} : { maxUsers: true as const }),
  }
}

/** F-20: a change of host, not of port: certificates are bound to the address. */
export const hostChanged = (initial: Pick<NodeDraft, 'host'>, draft: Pick<NodeDraft, 'host'>) => initial.host.trim() !== draft.host.trim()
