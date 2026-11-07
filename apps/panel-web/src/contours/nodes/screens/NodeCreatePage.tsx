import { ENGINE_NAMES, type EngineName } from '@iceslab/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { InstallStep } from '@/contours/nodes/components/InstallStep'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useCreateNode, useFleet, useRegions } from '@/contours/nodes/hooks/useNodes'
import { addressOf } from '@/contours/nodes/lib/nodeBody'
import { engineListForLabel, toggleEngine } from '@/contours/nodes/lib/nodeCreateForm'
import { domainOk } from '@/contours/nodes/lib/nodeEditForm'
import { parseMaxUsers, parseMultiplier } from '@/contours/nodes/lib/nodeLimits'
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols'
import { engineLabel } from '@/lib/domain/engines'
import { useDict, useLocale } from '@/lib/i18n'
import { isApiError } from '@/lib/net/errors'
import { failureText } from '@/lib/net/messages'
import type { CreateNodeInput, NodeHardening, NodeWithPayload } from '@/lib/old/nodes'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Check } from '@/ui/Check/Check'
import { Field, Input } from '@/ui/Field/Field'
import { Select } from '@/ui/Select/Select'
import { Step } from '@/ui/Step/Step'

type StepId = 'cores' | 'limits' | 'harden'

interface Hardening {
  ufw: boolean
  f2b: boolean
  fallback: boolean
  ssh: string
}

function hardeningBody(h: Hardening): NodeHardening | null {
  const allow = h.ssh.split(',').map((s) => s.trim()).filter(Boolean)
  const out: NodeHardening = {}
  if (h.ufw) out.ufwLockdown = true
  if (h.f2b) out.fail2ban = true
  if (h.fallback) out.realisticFallback = true
  if (allow.length > 0) out.sshAllowlist = allow
  return Object.keys(out).length > 0 ? out : null
}

export default function NodeCreatePage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const fleet = useFleet()
  const regions = useRegions()
  const create = useCreateNode()
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(DEFAULT_NODE_PORT))
  const [country, setCountry] = useState('')
  const [engines, setEngines] = useState<EngineName[]>([])
  const [domain, setDomain] = useState('')
  const [region, setRegion] = useState('')
  const [multiplier, setMultiplier] = useState('1')
  const [maxUsers, setMaxUsers] = useState('')
  const [harden, setHarden] = useState<Hardening>({ ufw: false, f2b: false, fallback: false, ssh: '' })
  const [open, setOpen] = useState<StepId | null>('cores')
  const [created, setCreated] = useState<NodeWithPayload | null>(null)
  const [refused, setRefused] = useState<{ name?: string; address?: string; form?: string }>({})

  if (created) return <InstallStep node={created} />

  const nodes = fleet.data?.nodes ?? []
  const address = addressOf({ host, port })
  // The server answers one field at a time and names nobody: the list says both first.
  const nameUsed = nodes.some((n) => n.name === name.trim())
  const addressHolder = nodes.find((n) => n.address === address)
  const portNumber = Number(port)
  const portBad = port.trim() !== '' && (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535)
  const bad = {
    name: nameUsed ? words.nameTaken : refused.name,
    host: addressHolder ? words.addressTaken(addressHolder.name) : refused.address,
    port: portBad ? words.portBad : undefined,
    domain: domainOk(domain) ? undefined : words.domainBad,
    multiplier: parseMultiplier(multiplier).ok ? undefined : words.multiplierBad,
    maxUsers: parseMaxUsers(maxUsers).ok ? undefined : words.maxUsersBad,
  }
  const ready = name.trim() !== '' && host.trim() !== '' && Object.values(bad).every((v) => v === undefined)
  const toggle = (step: StepId) => setOpen(open === step ? null : step)

  const submit = () => {
    const pair = engineListForLabel(engines, 'xray')
    const multiplierValue = parseMultiplier(multiplier)
    const maxUsersValue = parseMaxUsers(maxUsers)
    const input: CreateNodeInput = {
      name: name.trim(),
      address,
      protocol: pair.protocol,
      intendedEngines: pair.engines,
      countryCode: country.trim() ? country.trim().toUpperCase() : null,
      regionId: region || null,
      domain: domain.trim() || null,
      hardening: hardeningBody(harden),
      ...(multiplierValue.ok ? { consumptionMultiplier: multiplierValue.value } : {}),
      ...(maxUsersValue.ok ? { maxUsers: maxUsersValue.value } : {}),
    }
    setRefused({})
    create.mutate(input, {
      onSuccess: setCreated,
      onError: (err) => {
        if (isApiError(err) && err.status === 409 && /address/i.test(err.serverMessage ?? '')) setRefused({ address: words.addressTakenServer })
        else if (isApiError(err) && err.status === 409) setRefused({ name: words.nameTaken })
        else setRefused({ form: failureText(err, locale) })
      },
    })
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{words.createTitle}</h1>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{words.basics}</h2>
        <div className={styles.formRow}>
          <Field label={words.name} error={bad.name}>{(a11y) => <Input {...a11y} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={words.host} error={bad.host} hint={words.hostHint}>{(a11y) => <Input {...a11y} value={host} onChange={(e) => setHost(e.target.value)} />}</Field>
          <Field label={words.port} error={bad.port}>{(a11y) => <Input {...a11y} inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />}</Field>
          <Field label={words.country} hint={words.countryAuto}>{(a11y) => <Input {...a11y} maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} />}</Field>
        </div>
      </section>
      <Step optional title={words.coresStep} open={open === 'cores'} onToggle={() => toggle('cores')} value={engines.length > 0 ? engines.map(engineLabel).join(', ') : words.coresNone}>
        <p className={styles.note}>{words.coresHint}</p>
        <div className={styles.engineGrid}>
          {ENGINE_NAMES.map((engine) => (
            <label key={engine} className={styles.engineRow}>
              <Check label={engineLabel(engine)} checked={engines.includes(engine)} onChange={() => setEngines(toggleEngine(engines, engine))} />
              {engineLabel(engine)}
            </label>
          ))}
        </div>
      </Step>
      <Step optional title={words.domainStep} open={open === 'limits'} onToggle={() => toggle('limits')} value={domain || '-'}>
        <div className={styles.formRow}>
          <Field label={words.domain} error={bad.domain} hint={words.domainHint}>{(a11y) => <Input {...a11y} value={domain} onChange={(e) => setDomain(e.target.value)} />}</Field>
          <Field label={words.region} hint={words.regionHint}>{(a11y) => <Select {...a11y} value={region} onChange={(e) => setRegion(e.target.value)} options={[{ value: '', label: words.regionNone }, ...(regions.data?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))]} />}</Field>
          <Field label={words.multiplier} error={bad.multiplier} hint={words.multiplierHint}>{(a11y) => <Input {...a11y} inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />}</Field>
          <Field label={words.maxUsers} error={bad.maxUsers} hint={words.maxUsersHint}>{(a11y) => <Input {...a11y} inputMode="numeric" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />}</Field>
        </div>
      </Step>
      <Step optional title={words.hardenStep} open={open === 'harden'} onToggle={() => toggle('harden')} value={hardeningBody(harden) ? Object.keys(hardeningBody(harden) ?? {}).length : words.hardenNone}>
        <p className={styles.note}>{words.hardenHint}</p>
        {([['ufw', words.hardenUfw], ['f2b', words.hardenF2b], ['fallback', words.hardenFallback]] as const).map(([key, label]) => (
          <label key={key} className={styles.engineRow}>
            <Check label={label} checked={harden[key]} onChange={(on) => setHarden({ ...harden, [key]: on })} />
            {label}
          </label>
        ))}
        <Field label={words.hardenSsh} hint={words.hardenSshHint}>{(a11y) => <Input {...a11y} value={harden.ssh} onChange={(e) => setHarden({ ...harden, ssh: e.target.value })} />}</Field>
      </Step>
      <Banner tone="info" title={words.willCreate}>
        {words.willCreateBody}
      </Banner>
      {refused.form && <Banner tone="danger">{refused.form}</Banner>}
      <div className={styles.actions}>
        <Button onClick={() => void navigate('/nodes')}>{words.cancel}</Button>
        <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={submit}>
          {words.create}
        </Button>
      </div>
    </div>
  )
}
