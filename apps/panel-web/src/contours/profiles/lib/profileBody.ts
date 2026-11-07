// What a save sends. The server replaces a stored config whole, so a config that changed goes
// whole; a form that did not touch it sends none (F-K3), and shadowsocks keeps its server key.
import { awgHeaderProblems } from '@/contours/profiles/lib/awgHeaders'
import { portHopProblem } from '@/contours/profiles/lib/portHopRange'
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig'
import { ENGINE_CHOICE_PROTOCOLS } from '@/contours/profiles/lib/profileKinds'
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'
import { ssConfigPatch } from '@/contours/profiles/lib/ssServerKey'
import { profileAwgCreate, profileAwgPatch } from '@/lib/old/awg'
import type { CreateProfileInput, Profile, UpdateProfileInput } from '@/lib/old/profiles'

const NAME = /^[a-zA-Z0-9._-]+$/

export const engineOf = (values: Pick<FormValues, 'protocol' | 'engine'>): 'singbox' | null => (ENGINE_CHOICE_PROTOCOLS.includes(values.protocol) && values.engine === 'singbox' ? 'singbox' : null)

export function createBody(values: FormValues): CreateProfileInput {
  return {
    protocol: values.protocol,
    name: values.name,
    description: values.description.trim() || null,
    enabled: values.enabled,
    engine: engineOf(values),
    config: profileConfigOf(values) as never,
    ...(values.protocol === 'amneziawg' ? profileAwgCreate(values.awgGeneration) : {}),
  }
}

export function updateBody(initial: FormValues, values: FormValues, stored: Profile): UpdateProfileInput {
  const body: UpdateProfileInput = {}
  if (values.name !== initial.name) body.name = values.name
  if (values.description !== initial.description) body.description = values.description.trim() || null
  if (values.enabled !== initial.enabled) body.enabled = values.enabled
  if (engineOf(values) !== engineOf(initial)) body.engine = engineOf(values)
  if (JSON.stringify(profileConfigOf(values)) !== JSON.stringify(profileConfigOf(initial))) {
    const config = values.protocol === 'shadowsocks' ? ssConfigPatch(stored.config, true, values.ssMethod).config : profileConfigOf(values)
    if (config) body.config = config as never
  }
  if (values.protocol === 'amneziawg') Object.assign(body, profileAwgPatch(stored.awgProtocol, values.awgGeneration))
  return body
}

export interface FormProblems {
  name?: 'required' | 'latin'
  portHop?: 'hyPortHopStart' | 'hyPortHopEnd'
  awgHeaders?: true
  security?: 'network'
}

export function formProblems(values: FormValues): FormProblems {
  const hop = values.protocol === 'hysteria' ? portHopProblem(values.hyPortHopStart, values.hyPortHopEnd) : null
  const wrongNetwork = values.protocol === 'xray' && values.xraySecurity === 'reality' && !['raw', 'xhttp', 'grpc'].includes(values.xrayNetwork)
  return {
    ...(values.name === '' ? { name: 'required' as const } : NAME.test(values.name) ? {} : { name: 'latin' as const }),
    ...(hop ? { portHop: hop } : {}),
    ...(values.protocol === 'amneziawg' && awgHeaderProblems(values).size > 0 ? { awgHeaders: true as const } : {}),
    // A transport that REALITY cannot run on: the choice stays, the step asks (ARCH 06.11).
    ...(wrongNetwork ? { security: 'network' as const } : {}),
  }
}
