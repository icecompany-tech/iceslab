import { type EngineName, type NodeCoreVersions } from '@iceslab/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NodeCountry } from '@/contours/nodes/components/NodeCountry'
import { useNodeDraftLeave } from '@/contours/nodes/components/NodeDraftLeave'
import { guardedLeave } from '@/lib/leaveGuard'
import { CorePicker } from '@/contours/nodes/components/CorePicker'
import { CoreVersions } from '@/contours/nodes/components/CoreVersions'
import { InstallStep } from '@/contours/nodes/components/InstallStep'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { useCreateNode, useFleet, useRegions } from '@/contours/nodes/hooks/useNodes'
import { addressOf, validCountryCode, validNodePort } from '@/contours/nodes/lib/nodeBody'
import { createCoreVersions, engineListForLabel, toggleEngine } from '@/contours/nodes/lib/nodeCreateForm'
import { domainOk } from '@/contours/nodes/lib/nodeEditForm'
import { parseMaxUsers, parseMultiplier } from '@/contours/nodes/lib/nodeLimits'
import { DEFAULT_NODE_PORT } from '@/contours/nodes/lib/nodeProtocols'
import { engineLabel } from '@/lib/domain/engines'
import { useDict, useLocale } from '@/lib/i18n'
import { isApiError } from '@/lib/net/errors'
import { isRecord } from '@/lib/net/parse'
import { failureText } from '@/lib/net/messages'
import { coreVersionRefusal } from '@/lib/old/coreVersions'
import { nodeFieldKnown } from '@/lib/old/nodeFields'
import type { CreateNodeInput, NodeHardening, NodeWithPayload } from '@/lib/old/nodes'
import { Banner } from '@/ui/Banner/Banner'
import { Icon } from '@/ui/Icon/Icon'
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
  const [open, setOpen] = useState<StepId | null>(null)
  const [created, setCreated] = useState<NodeWithPayload | null>(null)
  const [refused, setRefused] = useState<{ name?: string; address?: string; ssh?: string; form?: string }>({})
  const [versions, setVersions] = useState<NodeCoreVersions>({})
  const [versionsRefused, setVersionsRefused] = useState<string[] | null>(null)

  const hardening = hardeningBody(harden)
  const dirty = Boolean(name || host || country || domain || region || maxUsers || engines.length ||
    hardening || Object.keys(versions).length || port !== String(DEFAULT_NODE_PORT) || multiplier !== '1')
  const leave = useNodeDraftLeave(!created && (dirty || create.isPending), create.isPending)
  const exit = () => guardedLeave(() => void navigate('/nodes'))
  if (created) return <InstallStep node={created} />

  const nodes = fleet.data?.nodes ?? []
  // An older server would refuse the key, so the picker shows only when the server names the field.
  const versionsKnown = nodeFieldKnown(fleet.data, 'coreVersions')
  const pickedVersions = createCoreVersions(versionsKnown, versions)
  const address = addressOf({ host, port })
  // The server answers one field at a time and names nobody: the list says both first.
  const nameUsed = nodes.some((n) => n.name === name.trim())
  const addressHolder = nodes.find((n) => n.address === address)
  const bad = {
    name: nameUsed ? words.nameTaken : refused.name,
    host: addressHolder ? words.addressTaken(addressHolder.name) : refused.address,
    port: validNodePort(port) ? undefined : words.portBad,
    country: validCountryCode(country) ? undefined : words.countryBad,
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
      hardening,
      ...(multiplierValue.ok ? { consumptionMultiplier: multiplierValue.value } : {}),
      ...(maxUsersValue.ok ? { maxUsers: maxUsersValue.value } : {}),
      ...(pickedVersions ? { coreVersions: pickedVersions } : {}),
    }
    setRefused({})
    setVersionsRefused(null)
    create.mutate(input, {
      onSuccess: setCreated,
      onError: (err) => {
        const lines = coreVersionRefusal(err)
        if (lines) {
          setVersionsRefused(lines)
          setOpen('cores')
        } else if (isApiError(err) && err.status === 400 && isRecord(err.body) &&
          Array.isArray(err.body.issues) && err.body.issues.some(issue =>
            isRecord(issue) && Array.isArray(issue.path) && issue.path[0] === 'hardening' && issue.path[1] === 'sshAllowlist')) {
          setOpen('harden')
          setRefused({ ssh: words.sshRefused })
        } else if (isApiError(err) && err.status === 409 && /address/i.test(err.serverMessage ?? '')) setRefused({ address: words.addressTakenServer })
        else if (isApiError(err) && err.status === 409) setRefused({ name: words.nameTaken })
        else setRefused({ form: failureText(err, locale) })
      },
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.createHead}>
        <Button aria-label={words.prevPage} onClick={exit}><Icon name="chevronLeft"/></Button>
        <h1 className={styles.pageTitle}>{words.createTitle}</h1><span className={styles.subhead}>{words.createSubtitle}</span>
        <div className={styles.actions}>
          <Button size="md" onClick={exit}>{words.cancel}</Button>
          <Button size="md" variant="primary" icon={<Icon name="plus"/>} disabled={!ready} loading={create.isPending} onClick={submit}>{words.create}</Button>
        </div>
      </header>
      <div className={styles.createColumns} inert={create.isPending}><div className={styles.createMain}>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{words.basics}</h2>
        <div className={styles.formRow}>
          <Field label={words.name} error={bad.name}>{(a11y) => <Input {...a11y} autoFocus placeholder={words.nameExample} value={name} onChange={(e) => { setName(e.target.value); setRefused((old) => ({ ...old, name: undefined })) }} />}</Field>
          <NodeCountry auto value={country} onChange={setCountry} />
        </div>
        <div className={styles.createAddress}>
          <Field label={words.host} error={bad.host} hint={words.hostHint}>{(a11y) => <Input {...a11y} placeholder={words.addressExample} value={host} onChange={(e) => { setHost(e.target.value); setRefused((old) => ({ ...old, address: undefined })) }} />}</Field>
          <Field label={words.port} error={bad.port}>{(a11y) => <Input {...a11y} inputMode="numeric" value={port} onChange={(e) => { setPort(e.target.value); setRefused((old) => ({ ...old, address: undefined })) }} />}</Field>
        </div>
      </section>
      <section className={styles.createSettings}>
      <header><h2 className={styles.panelTitle}>{words.nodeSettings}</h2><p className={styles.note}>{words.stepOrder}</p></header>
      <Step optional title={words.coresStep} open={open === 'cores'} onToggle={() => toggle('cores')} value={engines.length > 0 ? engines.map(engineLabel).join(', ') : words.coresNone}>
        <p className={styles.note}>{words.coresHint}</p>
        <CorePicker installed={engines} versions={versions} toggle={engine => setEngines(toggleEngine(engines, engine))}>
          {engine => engine === 'tproxy-server' ? <p className={styles.note}>{words.webUnavailable}</p> : <>
            {versionsKnown && <CoreVersions selected={engine} value={versions} onChange={setVersions} refusal={versionsRefused} />}
            {versionsKnown && <p className={styles.note}>{words.coreVersionsCreateNote}</p>}
          </>}
        </CorePicker>
      </Step>
      <Step optional title={words.domainStep} open={open === 'limits'} onToggle={() => toggle('limits')} value={domain || '-'}>
        <div className={styles.limitFields}>
          <Field label={words.domain} error={bad.domain} hint={words.domainHint}>{(a11y) => <Input {...a11y} value={domain} onChange={(e) => setDomain(e.target.value)} />}</Field>
          <Field label={words.region} hint={words.regionHint}>{(a11y) => <Select {...a11y} value={region} onChange={(e) => setRegion(e.target.value)} options={[{ value: '', label: words.regionNone }, ...(regions.data?.regions ?? []).map((r) => ({ value: r.id, label: r.name }))]} />}</Field>
          <Field label={words.multiplier} error={bad.multiplier} hint={words.multiplierHint}>{(a11y) => <Input {...a11y} inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />}</Field>
          <Field label={words.maxUsers} error={bad.maxUsers} hint={words.maxUsersHint}>{(a11y) => <Input {...a11y} inputMode="numeric" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />}</Field>
        </div>
      </Step>
      <Step optional title={words.hardenStep} open={open === 'harden'} onToggle={() => toggle('harden')} value={hardening ? Object.keys(hardening).length : words.hardenNone}>
        <div className={styles.hardenFields}><p className={styles.note}>{words.hardenHint}</p>
        {([['ufw', words.hardenUfw], ['f2b', words.hardenF2b], ['fallback', words.hardenFallback]] as const).map(([key, label]) => (
          <label key={key} className={styles.engineRow}>
            <Check label={label} checked={harden[key]} onChange={(on) => setHarden({ ...harden, [key]: on })} />
            <span>{label}<small>{words.hardeningDetails[key]}</small></span>
          </label>
        ))}
        <Field label={words.hardenSsh} error={refused.ssh}>{(a11y) => <Input {...a11y} value={harden.ssh} onChange={(e) => { setHarden({ ...harden, ssh: e.target.value }); setRefused(old => ({ ...old, ssh: undefined })) }} />}</Field>
        <Banner tone="warn">{words.hardenSshHint}</Banner></div>
      </Step>
      </section>
      {refused.form && <Banner tone="danger">{refused.form}</Banner>}
      </div>
      <aside className={styles.createSummary}>
        <h2 className={styles.panelTitle}>{words.willCreate}</h2>
        <dl>
          {[[words.recordLabel, name.trim() || words.noName], [words.connectionLabel, host.trim() ? address : words.noAddress],
            [words.coresStep, engines.length ? engines.map(engineLabel).join(', ') : words.coresNone],
            ...(domain.trim() ? [[words.domain, domain.trim()]] : []),
            ...(region ? [[words.region, regions.data?.regions.find(item => item.id === region)?.name ?? region]] : []),
            ...(multiplier !== '1' ? [[words.multiplier, multiplier]] : []), ...(maxUsers.trim() ? [[words.maxUsers, maxUsers.trim()]] : []),
            [words.securityLabel, [harden.ufw && words.hardenUfw, harden.f2b && words.hardenF2b, harden.fallback && words.hardenFallback].filter(Boolean).join(', ') || words.hardenNone],
            ...(harden.ssh.trim() ? [[words.hardenSsh, harden.ssh.trim()]] : [])].map(([label,value])=>
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <p>{words.installNote}</p>
      </aside>
      </div>
      {leave}
    </div>
  )
}
