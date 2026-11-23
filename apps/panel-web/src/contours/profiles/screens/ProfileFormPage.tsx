import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import styles from '@/contours/profiles/components/profiles.module.css'
import { useProtocolSteps, type StepDef } from '@/contours/profiles/components/ProtocolSteps'
import { RecipeRail } from '@/contours/profiles/components/RecipeRail'
import { DICT } from '@/contours/profiles/dict'
import { useAllBindings, useAllHosts, useCreateProfile, useDeleteProfile, useDestCheck, useFleetNames, useFormats, useKeypair, useProfilesList, useUpdateProfile } from '@/contours/profiles/hooks/useProfiles'
import { generateStep, useGenerateGate } from '@/contours/profiles/lib/generateImpact'
import { handshakeRecordFacts } from '@/contours/profiles/lib/handshakeRecord'
import { createBody, formProblems, updateBody } from '@/contours/profiles/lib/profileBody'
import { defaults } from '@/contours/profiles/lib/profileDefaults'
import type { FormValues } from '@/contours/profiles/lib/profileFormValues'
import { isPlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol'
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig'
import { ENGINE_CHOICE_PROTOCOLS, profileKindKey } from '@/contours/profiles/lib/profileKinds'
import { randomShortIds, recipeApplyPlan, type Recipe } from '@/contours/profiles/lib/recipes'
import { singboxXrayPatch } from '@/contours/profiles/lib/xrayTransports'
import { DICT as RECIPE_DICT } from '@/contours/profiles/recipesDict'
import { RadioRow } from '@/ui/RadioRow/RadioRow'
import { settleXrayFields, xrayFieldReactions } from '@/contours/profiles/lib/xrayFieldReactions'
import { lastHostCheck, useSquads } from '@/lib/domain/squads'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import type { Profile, ProfileKeyImpact, TestConnectResult } from '@/lib/old/profiles'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Confirm } from '@/ui/Dialog/Confirm'
import { Field, Input } from '@/ui/Field/Field'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import paperExamples from '@/contours/profiles/console/paper-examples.json'
import { hysteriaFile, isNativeHysteria, printHysteria, readHysteria } from '@/contours/profiles/console/hysteriaYaml'
import { CreateConsole } from '@/contours/profiles/console/CreateConsole'
import { consoleError, unrepresentedField, fromForm, isObject, printInbound, readInbound, rebase, supportsConsole } from '@/contours/profiles/console/createInbound'
import type { ProfileError } from '@/ui/CodeArea/text'
import { Step } from '@/ui/Step/Step'
import { useToast } from '@/ui/Toast/useToast'

type KeyAsk = { kind: 'confirm'; impact: ProfileKeyImpact } | { kind: 'unknown' } | null

interface Tile {
  key: string
  label: string
  protocol: FormValues['protocol']
  subprotocol?: FormValues['xraySubprotocol']
  /** Fixed by the protocol; absent where the Core step chooses. */
  engine?: FormValues['engine']
}

// Flat tiles (design 05.11): VLESS is `protocol: xray` and `subprotocol: vless`, the core comes second.
const TILES: readonly Tile[] = [
  { key: 'vless', label: 'VLESS', protocol: 'xray', subprotocol: 'vless' },
  { key: 'vmess', label: 'VMess', protocol: 'xray', subprotocol: 'vmess' },
  { key: 'trojan', label: 'Trojan', protocol: 'xray', subprotocol: 'trojan' },
  { key: 'hysteria', label: 'Hysteria 2', protocol: 'hysteria' },
  { key: 'amneziawg', label: 'AmneziaWG', protocol: 'amneziawg', engine: 'native' },
  { key: 'shadowsocks', label: 'Shadowsocks 2022', protocol: 'shadowsocks' },
  { key: 'naive', label: 'NaiveProxy', protocol: 'naive', engine: 'native' },
  { key: 'mieru', label: 'Mieru', protocol: 'mieru', engine: 'native' },
  { key: 'mtproto', label: 'MTProto', protocol: 'mtproto', engine: 'native' },
  { key: 'socks5', label: 'SOCKS5', protocol: 'xray', subprotocol: 'socks', engine: 'native' },
  { key: 'http', label: 'HTTP', protocol: 'xray', subprotocol: 'http', engine: 'native' },
  { key: 'tuic', label: 'TUIC', protocol: 'tuic', engine: 'native' },
  { key: 'anytls', label: 'AnyTLS', protocol: 'anytls', engine: 'native' },
  { key: 'shadowtls', label: 'ShadowTLS', protocol: 'shadowtls', engine: 'native' },
]

const tileOf = (values: Pick<FormValues, 'protocol' | 'xraySubprotocol'>) => TILES.find((t) => t.protocol === values.protocol && (t.protocol !== 'xray' || t.subprotocol === values.xraySubprotocol))

function destWords(row: TestConnectResult, words: { destRefused: (why: string) => string; destRecord: (b: number, l: number) => string }) {
  const facts = handshakeRecordFacts(row)
  return words.destRefused(facts?.over ? words.destRecord(facts.bytes, facts.limit) : (row.error ?? '-'))
}

function RightColumn({ profile, values, rail }: { profile: Profile | null; values: FormValues; rail: ReactNode }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const bindings = useAllBindings()
  const hosts = useAllHosts()
  const fleet = useFleetNames()
  const formats = useFormats(profile?.id ?? null)
  const nodeName = (id: string) => fleet.data?.nodes.find((n) => n.id === id)?.name ?? id.slice(0, 8)
  const mine = (bindings.data?.bindings ?? []).filter((b) => b.profileId === profile?.id)
  const myIds = new Set(mine.map((b) => b.id))
  const myHosts = (hosts.data?.hosts ?? []).filter((h) => myIds.has(h.bindingId))
  const leftOut = formats.data?.formats.filter((f) => !f.carried).map((f) => f.format) ?? []
  const formatsUnknown = formats.isError || formats.data === null
  return (
    <aside className={styles.right}>
      {profile ? (
        <>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.rightHosts}</h2>
            {(hosts.isError || bindings.isError) && (
              <QueryFailedLine
                retryLabel={words.retry}
                onRetry={() => {
                  void hosts.refetch()
                  void bindings.refetch()
                }}
              >
                {words.rightHostsFailed}
              </QueryFailedLine>
            )}
            {hosts.data && bindings.data && myHosts.length === 0 && <p className={styles.note}>{words.rightNoHosts}</p>}
            <ul className={styles.hostList}>
              {myHosts.map((host) => {
                const binding = mine.find((b) => b.id === host.bindingId)
                return (
                  <li key={host.id}>
                    <Link className={styles.link} to={`/hosts/${host.id}`}>
                      {host.remark}
                    </Link>
                    <span className={styles.muted}>
                      {' '}
                      {binding ? `${nodeName(binding.nodeId)}:${binding.port}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className={styles.note}>{words.rightUsers(fmtNumber(profile.userCount ?? 0, locale))}</p>
          </section>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.willNotGet}</h2>
            <p className={styles.note}>{formatsUnknown ? words.willNotGetUnknown : leftOut.length > 0 ? leftOut.join(', ') : words.willNotGetNone}</p>
          </section>
          {rail}
        </>
      ) : (
        <>
          {rail}
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.rightGets}</h2>
            <p className={styles.note}>
              {values.protocol}, {values.engine === 'singbox' ? words.engineSingbox : words.engineNative}
            </p>
            <p className={styles.note}>{words.rightNoHosts}</p>
          </section>
        </>
      )}
    </aside>
  )
}

function ProfileForm({ profile, onDone, reviewConsole }: { reviewConsole: boolean; profile: Profile | null; onDone: (saved: Profile) => void }) {
  const words = useDict(DICT)
  const recipeWords = useDict(RECIPE_DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const isEdit = profile !== null
  const [initial, setInitial] = useState<FormValues>(() => settleXrayFields(defaults(profile)))
  const [values, setValues] = useState<FormValues>(initial)
  const hysteria = isNativeHysteria(values)
  const canConsole = hysteria || supportsConsole(values)
  const tile = tileOf(values)
  const exampleKey = (tile?.key ?? '') + (values.engine === 'singbox' ? '/singbox' : '')
  const examples: Record<string, { file: string; engine: string; text: string }> = import.meta.env.MODE === 'paper-review' && reviewConsole ? paperExamples : {}
  const example = hysteria ? undefined : examples[exampleKey]
  const storedDocument = reviewConsole && profile && 'reviewDocument' in profile ? profile.reviewDocument : null
  const exampleInitial = isObject(storedDocument) && storedDocument.key === exampleKey && typeof storedDocument.text === 'string' ? storedDocument.text : example?.text
  const [exampleDrafts, setExampleDrafts] = useState<Record<string, string>>({})
  const [exampleOpen, setExampleOpen] = useState(false)
  const exampleText = exampleDrafts[exampleKey] ?? exampleInitial ?? ''
  const storedInbound = reviewConsole && profile && 'reviewInbound' in profile ? profile.reviewInbound : null
  const [consoleState, setConsoleState] = useState(() => ({
    base: fromForm(initial), raw: isObject(storedInbound) ? storedInbound : fromForm(initial),
  }))
  const [draft, setDraft] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<ProfileError | null>(null)
  const [switchTo, setSwitchTo] = useState<Tile | null>(null)
  const currentRaw = () => rebase(consoleState.base, fromForm(values), consoleState.raw)
  const currentText = () => hysteria ? printHysteria(values) : printInbound(currentRaw())
  function readDraft() {
    try {
      if (hysteria) {
        const next = draft === null ? values : readHysteria(draft, values)
        setEditorError(null)
        return { values: next, raw: null }
      }
      const parsed = draft === null ? { raw: currentRaw(), values } : readInbound(draft, values)
      if (draft !== null && !reviewConsole) {
        const field = unrepresentedField(parsed.raw, fromForm(parsed.values))
        if (field) throw Error(words.unsupportedConsoleField(field))
      }
      setEditorError(null)
      return parsed
    } catch (error) {
      setEditorError(consoleError(error, draft ?? ''))
      return null
    }
  }
  function changeMode(mode: 'form' | 'console') {
    if (example) { setExampleOpen(mode === 'console'); return }
    if (mode === 'console') {
      setDraft(currentText())
      setEditorError(null)
    } else if (draft !== null) {
      const parsed = readDraft()
      if (!parsed) return
      setValues(parsed.values)
      if (parsed.raw) setConsoleState({ base: fromForm(parsed.values), raw: parsed.raw })
      setDraft(null)
    }
  }
  const [openSteps, setOpenSteps] = useState<string[]>(isEdit ? [] : ['protocol'])
  function toggleStep(id: string) {
    setOpenSteps(previous => previous.includes(id) ? previous.filter(step => step !== id) : isEdit ? [id] : [...previous, id])
  }
  const stepArea = useRef<HTMLDivElement>(null)
  const [nameVisited, setNameVisited] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [destError, setDestError] = useState<string | null>(null)
  const [keyAsk, setKeyAsk] = useState<KeyAsk>(null)
  const [deleting, setDeleting] = useState(false)
  const keypair = useKeypair()
  const gate = useGenerateGate(profile?.id ?? null)
  const create = useCreateProfile()
  const update = useUpdateProfile(profile?.id ?? '')
  const remove = useDeleteProfile()
  const check = useDestCheck()
  const bindings = useAllBindings()
  const hosts = useAllHosts()
  const squads = useSquads()

  const patch = (next: Partial<FormValues>) => {
    setValues((previous) => {
      const merged = { ...previous, ...next }
      return { ...merged, ...(xrayFieldReactions(merged, previous) ?? {}) }
    })
    setRefusal(null)
    if ('xrayDest' in next || 'xraySecurity' in next) setDestError(null)
  }

  const runKeys = () => {
    const protocol = values.protocol === 'amneziawg' ? 'amneziawg' : 'xray'
    keypair.mutate(protocol, {
      onSuccess: (pair) => {
        patch(protocol === 'amneziawg' ? { awgServerPriv: pair.privateKey, awgServerPub: pair.publicKey } : { xrayPrivateKey: pair.privateKey, xrayPublicKey: pair.publicKey })
        toast.show(words.keysGenerated)
      },
      onError: (err) => toast.show(failureText(err, locale), 'failed'),
    })
  }

  /**
   * Only the protocol's own recipe keys are written (recipeApplyPlan), the rest is named. A recipe
   * means a working combo after one click, so missing key material is generated; present keys stay,
   * they are never replaced in passing: that goes through the key window.
   */
  const applyRecipe = (recipe: Recipe) => {
    const { apply, skipped } = recipeApplyPlan(values.protocol, recipe, values)
    patch(apply as Partial<FormValues>)
    if (skipped.length > 0) toast.show(recipeWords.skippedFields(skipped.join(', ')), 'partial')
    const keysFailed = (err: unknown) => toast.show(recipeWords.keysFailed(failureText(err, locale)), 'partial')
    if (recipe.protocol === 'xray' && !isPlainSubprotocol(String(apply.xraySubprotocol ?? values.xraySubprotocol))) {
      if (!values.xrayShortIds.trim()) patch({ xrayShortIds: randomShortIds() })
      if (!values.xrayPrivateKey) keypair.mutate('xray', { onSuccess: (pair) => patch({ xrayPrivateKey: pair.privateKey, xrayPublicKey: pair.publicKey }), onError: keysFailed })
    }
    if (recipe.protocol === 'amneziawg' && !values.awgServerPriv) {
      keypair.mutate('amneziawg', { onSuccess: (pair) => patch({ awgServerPriv: pair.privateKey, awgServerPub: pair.publicKey }), onError: keysFailed })
    }
  }

  // The count is read again before the window (A-225): a cached zero must not let the key change.
  const onGenerate = () =>
    gate.press((fresh) => {
      switch (generateStep(fresh)) {
        case 'run':
          runKeys()
          return
        case 'confirm':
          if (fresh.kind === 'ready') setKeyAsk({ kind: 'confirm', impact: fresh })
          return
        case 'unknown':
          setKeyAsk({ kind: 'unknown' })
          return
        case 'wait':
          return
      }
    })

  const steps: StepDef[] = useProtocolSteps({ values, patch, isEdit, profile, onGenerate, generating: keypair.isPending || gate.checking || gate.impact.kind === 'loading', destError })
  const problems = formProblems(values)
  const body = profile ? updateBody(initial, values, profile) : null
  const manualChange = canConsole && (
    (draft !== null && draft !== currentText()) ||
    !hysteria && JSON.stringify(consoleState.raw) !== JSON.stringify(isObject(storedInbound) ? storedInbound : fromForm(initial))
  )
  const showingExample = Boolean(example && exampleOpen)
  const inConsole = showingExample || draft !== null
  const changed = Boolean(example && exampleText !== exampleInitial) || !profile || Object.keys(body ?? {}).length > 0 || manualChange
  // An old row the operator did not touch must not close a rename: its config is not sent.
  const configTouched = !profile || JSON.stringify(profileConfigOf(values)) !== JSON.stringify(profileConfigOf(initial))
  const blocked = problems.name !== undefined || (configTouched && Object.keys(problems).length > 0)
  const kindKey = profileKindKey(values.protocol, values.engine, values.xraySubprotocol)
  const pickTile = (next: Tile) => {
    if (next.key === tile?.key) return
    if (canConsole && JSON.stringify(consoleState.raw) !== JSON.stringify(consoleState.base)) { setSwitchTo(next); return }
    const fresh = settleXrayFields({ ...defaults(null), name: values.name, description: values.description, enabled: values.enabled, protocol: next.protocol, engine: next.engine ?? 'native', ...(next.subprotocol ? { xraySubprotocol: next.subprotocol } : {}) })
    setOpenSteps(['protocol'])
    setValues({ ...fresh, ...singboxXrayPatch(fresh) })
  }
  const setEngine = (engine: FormValues['engine']) => {
    const next = { ...values, engine }
    setValues({ ...next, ...singboxXrayPatch(next) })
  }
  const hasEngineChoice = !tile?.engine && ENGINE_CHOICE_PROTOCOLS.includes(values.protocol) && !isPlainSubprotocol(values.xraySubprotocol)

  const activeSteps = ['protocol', ...(hasEngineChoice ? ['engine'] : []), ...steps.filter((step) => !step.faded).map((step) => step.id)]
  const advance = (id: string) => {
    const next = activeSteps[activeSteps.indexOf(id) + 1]
    if (isEdit || !next) return null
    return <div className={styles.stepFooter}><Button onClick={() => {
      setOpenSteps([next])
      requestAnimationFrame(() => stepArea.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus())
    }}>{words.next}</Button></div>
  }

  const afterSave = async (saved: Profile, submitted = values) => {
    // E23 by the old request after the save (6.6): a refusal stands at the field.
    if (saved.protocol === 'xray' && submitted.xraySecurity === 'reality' && submitted.xrayRealityMode === 'steal-others') {
      const refused = await check.mutateAsync(saved.id).catch(() => [])
      const first = refused[0]
      if (first) {
        setDestError(destWords(first, words))
        setOpenSteps(['masquerade'])
        toast.show(words.savedDestRefused, 'partial')
        if (!isEdit) onDone(saved)
        return
      }
    }
    toast.show(isEdit ? words.saved : words.createdDone(saved.name))
    onDone(saved)
  }

  const submit = () => {
    if (create.isPending || update.isPending || check.isPending) return
    const parsed = canConsole ? readDraft() : { raw: null, values }
    if (!parsed) return
    const next = parsed.values
    if (problems.name) { setNameVisited(true); return }
    if (draft !== null && Object.keys(formProblems(next)).length) {
      setEditorError({ line: 1, column: 1, reason: words.invalidCombination })
      return
    }
    if (!inConsole && blocked) return
    const extra = example && (showingExample || exampleText !== exampleInitial) ? { reviewDocument: { key: exampleKey, text: exampleText } } : reviewConsole && supportsConsole(values) ? { reviewInbound: parsed.raw } : reviewConsole && isObject(storedInbound) ? { reviewInbound: null } : {}
    const onError = (err: unknown) => setRefusal(failureText(err, locale))
    if (profile) {
      update.mutate({ ...updateBody(initial, next, profile), ...extra }, {
        onSuccess: (saved) => {
          setInitial(next)
          setValues(next)
          if (hysteria && draft !== null) setDraft(printHysteria(next))
          if (parsed.raw) {
            setConsoleState({ base: fromForm(next), raw: parsed.raw })
            if (draft !== null) setDraft(printInbound(parsed.raw))
          }
          void afterSave(saved, next)
        },
        onError,
      })
    } else {
      create.mutate({ ...createBody(next), ...extra }, { onSuccess: (saved) => void afterSave(saved, next), onError })
    }
  }

  const switchProtocol = (tile: Tile) => {
    const fresh = settleXrayFields({ ...defaults(null), name: values.name, description: values.description, enabled: values.enabled,
      protocol: tile.protocol, engine: tile.engine ?? 'native', xraySubprotocol: tile.subprotocol ?? 'vless' })
    const raw = fromForm(fresh)
    setValues(fresh)
    setConsoleState({ base: raw, raw })
    setExampleOpen(inConsole && !supportsConsole(fresh) && !isNativeHysteria(fresh))
    setDraft(!inConsole ? null : isNativeHysteria(fresh) ? printHysteria(fresh) : supportsConsole(fresh) ? printInbound(raw) : null)
    setEditorError(null)
    setSwitchTo(null)
  }
  const chooseInConsole = (label: string) => {
    const target = TILES.find((item) => item.label === label)
    if (!target || target.key === tile?.key) return
    if (example ? exampleText !== exampleInitial : draft !== currentText() || JSON.stringify(consoleState.raw) !== JSON.stringify(consoleState.base)) setSwitchTo(target)
    else switchProtocol(target)
  }

  const updateInConsole = (next: FormValues, raw: ReturnType<typeof fromForm>) => {
    setValues(next)
    setConsoleState({ base: fromForm(next), raw })
    setDraft(printInbound(raw))
    setEditorError(null)
  }
  const suggestSecurity = (security: FormValues['xraySecurity']) => {
    if (draft === null) return
    // The value under the cursor may still be incomplete. Repair only that token before parsing.
    const normalized = draft.replace(/("security"\s*:\s*)"[^"\n]*"/, (_, prefix: string) => prefix + JSON.stringify(values.xraySecurity))
    try {
      const parsed = readInbound(normalized, values)
      const next = { ...parsed.values, xraySecurity: security }
      updateInConsole(next, rebase(fromForm(parsed.values), fromForm(next), parsed.raw))
    } catch (err) { setEditorError(consoleError(err, draft)) }
  }
  const generateInConsole = async () => {
    if (isEdit || hysteria || draft === null) return
    const parsed = readDraft()
    if (!parsed?.raw) return
    const pair = await keypair.mutateAsync('xray')
    const next = { ...parsed.values, xrayPrivateKey: pair.privateKey, xrayPublicKey: pair.publicKey,
      xrayShortIds: parsed.values.xrayShortIds || randomShortIds() }
    updateInConsole(next, rebase(fromForm(parsed.values), fromForm(next), parsed.raw))
  }
  const editText = (text: string) => {
    if (hysteria) { setDraft(text); setEditorError(null); setRefusal(null); return }
    try {
      const proposed: unknown = JSON.parse(text)
      if (isObject(proposed) && (proposed.tag !== null || proposed.listen !== '0.0.0.0' ||
        proposed.port !== null || !isObject(proposed.settings) || JSON.stringify(proposed.settings.clients) !== '[]')) {
        setEditorError({ line: 1, column: 1, reason: words.managedFields })
        return
      }
    } catch { /* Keep incomplete text while the operator types. */ }
    setDraft(text)
    setEditorError(null)
    setRefusal(null)
  }

  const enabledField = (
    <label className={styles.checkRow}>
    <input type="checkbox" checked={values.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
    {words.enabled}
    </label>
  )

  const formActions = (
    <>
      <Button size={isEdit ? 'sm' : 'md'} onClick={() => void navigate('/profiles')}>{words.cancel}</Button>
      <Button size={isEdit ? 'sm' : 'md'} icon={isEdit ? undefined : <Icon name="plus" />} variant="primary" disabled={!changed || (inConsole ? Boolean(problems.name) : blocked)} loading={create.isPending || update.isPending || check.isPending} onClick={submit}>
        {isEdit ? words.save : words.create}
      </Button>
    </>
  )

  const impact = keyAsk?.kind === 'confirm' ? keyAsk.impact : null
  // F-32: hosts reach the profile through its bindings, so all three lists must be in before anyone can say "nobody loses".
  const myBindings = bindings.data ? new Set(bindings.data.bindings.filter((b) => b.profileId === profile?.id).map((b) => b.id)) : undefined
  const myHostIds = myBindings && hosts.data ? hosts.data.hosts.filter((h) => myBindings.has(h.bindingId)).map((h) => h.id) : undefined
  const lastOf = lastHostCheck(myHostIds, squads.data)
  const deleteLock = lastOf === null ? words.deleteSquadsUnknown : lastOf.length > 0 ? words.deleteLastHost(lastOf.join(', ')) : null
  return (
    <div className={isEdit ? styles.page : styles.creation} onKeyDown={(event) => {
      if (inConsole && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (changed) submit()
      }
    }}>
      <header className={styles.formHeader}>
        {!isEdit && <Link className={styles.backButton} to="/profiles" aria-label={words.backToList}><Icon name="chevronLeft" /></Link>}
        <h1 className={styles.pageTitle}>{profile ? profile.name : words.newProfile}</h1>
        {!isEdit && <div className={styles.actions}>{formActions}</div>}
      </header>
      {refusal && <Banner tone="danger">{refusal}</Banner>}
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={isEdit ? styles.panel : styles.basics}>
            <h2 className={styles.panelTitle}>{words.stepName}</h2>
            <div className={styles.twoFields}>
              <Field label={words.name} error={nameVisited && problems.name === 'required' ? words.nameRequired : problems.name === 'latin' ? words.nameLatin : undefined}>
                {(a11y) => <Input {...a11y} placeholder={words.namePlaceholder} onBlur={() => setNameVisited(true)} value={values.name} onChange={(e) => patch({ name: e.target.value })} />}
              </Field>
              <Field label={words.description}>{(a11y) => <Input {...a11y} placeholder={words.descriptionPlaceholder} value={values.description} onChange={(e) => patch({ description: e.target.value })} />}</Field>
            </div>
            {isEdit && enabledField}
          </section>
          <div ref={stepArea} className={isEdit ? styles.left : styles.wizard}>
          {(!isEdit || canConsole || example) && <header className={styles.wizardHeading}>
            <div>
              <h2 className={styles.panelTitle}>{words.protocolSettings}</h2>
              <p className={styles.note}>{!inConsole ? words.stepGuide : words.consoleGuide}</p>
            </div>
            {(canConsole || example) && <Segmented<'form' | 'console'> label={words.protocolSettings} value={inConsole ? 'console' : 'form'} onChange={changeMode} options={[{ value: 'form', label: words.formMode }, { value: 'console', label: words.consoleMode }]} />}
          </header>}
          {(canConsole && draft !== null) || showingExample ? (
            <CreateConsole key={hysteria ? hysteriaFile.file : example?.file ?? 'inbound'} text={showingExample ? exampleText : draft ?? ''} original={showingExample ? exampleInitial ?? '' : currentText()} error={showingExample ? null : editorError} isEdit={isEdit} protocol={{ label: tile?.label ?? values.protocol, file: hysteria ? hysteriaFile : showingExample ? example : undefined, preview: showingExample }}
              choices={[...TILES.filter((one) => !['mtproto','socks5','http'].includes(one.key)), ...TILES.filter((one) => ['mtproto','socks5','http'].includes(one.key))].map((one) => ({
                label: one.label, engine: ['vless','trojan'].includes(one.key) ? 'xray, sing-box' : one.key === 'vmess' ? 'xray' : one.key === 'hysteria' ? 'hysteria' : words.formMode,
                available: !isEdit || (supportsConsole(values) && ['vless','vmess','trojan'].includes(one.key)) || one.key === tile?.key,
              })).concat([{ label: 'WEB', engine: 'tproxy-server', available: false }])}
              actions={{ onProtocol: chooseInConsole, onEdit: showingExample ? (text) => setExampleDrafts(previous => ({ ...previous, [exampleKey]: text })) : editText, onSecurity: suggestSecurity, onGenerate: generateInConsole }} />
          ) : <>
          <Step title={words.stepProtocol} open={openSteps.includes('protocol')} onToggle={() => toggleStep('protocol')} value={tile?.label ?? values.protocol}>
            {!isEdit ? (
              <div className={styles.tiles} role="radiogroup" aria-label={words.stepProtocol}>
                {TILES.map((one) => (
                  <button key={one.key} type="button" role="radio" aria-checked={one.key === tile?.key} className={`${styles.tile} ${one.key === tile?.key ? styles.tileOn : ''}`} onClick={() => pickTile(one)}>
                    {one.label}
                  </button>
                ))}
              </div>
            ) : values.protocol === 'xray' && !isPlainSubprotocol(values.xraySubprotocol) ? (
              TILES.filter((one) => one.protocol === 'xray' && !isPlainSubprotocol(one.subprotocol)).map((one) => (
                <RadioRow key={one.key} name="subprotocol" title={one.label} checked={values.xraySubprotocol === one.subprotocol} closedReason={one.subprotocol === 'vmess' && values.engine === 'singbox' ? words.onlyXrayCore : undefined} onSelect={() => one.subprotocol && patch({ xraySubprotocol: one.subprotocol })} />
              ))
            ) : (
              <p className={styles.note}>{tile?.label ?? values.protocol}</p>
            )}
            {advance('protocol')}
          </Step>
          {hasEngineChoice && (
            <Step title={words.stepEngine} open={openSteps.includes('engine')} onToggle={() => toggleStep('engine')} value={values.engine === 'singbox' ? words.engineSingbox : words.engineNative}>
              <RadioRow name="engine" title={words.engineNative} checked={values.engine === 'native'} onSelect={() => setEngine('native')} />
              <RadioRow name="engine" title={words.engineSingbox} description={values.protocol === 'xray' ? words.singboxOnlyReality : undefined} checked={values.engine === 'singbox'} closedReason={values.xraySubprotocol === 'vmess' && values.protocol === 'xray' ? words.onlyVlessTrojan : undefined} onSelect={() => setEngine('singbox')} />
              {advance('engine')}
            </Step>
          )}
          {steps.map((step) =>
            step.faded ? (
              <section key={step.id} className={styles.fadedStep}>
                <span>{step.title}</span>
                <span>{step.faded}</span>
              </section>
            ) : (
              <Step key={step.id} title={step.title} optional={step.optional} value={step.invalid ? <span className={styles.danger}><Icon name="warn" size="sm" /></span> : step.value} open={openSteps.includes(step.id)} onToggle={() => toggleStep(step.id)}>
                {step.body}
                {advance(step.id)}
              </Step>
            ),
          )}
          </>}
          </div>
          {!isEdit && enabledField}
          {isEdit && <div className={styles.actions}>
            {profile && (
              <Button variant="danger" disabled={deleteLock !== null} title={deleteLock ?? undefined} onClick={() => setDeleting(true)}>
                {words.delete}
              </Button>
            )}
            {profile && deleteLock && <span className={styles.lastHost}>{deleteLock}</span>}
            <span className={styles.spacer} />
            {formActions}
          </div>}
        </div>
        <RightColumn
          profile={profile}
          values={values}
          rail={
            <RecipeRail
              key={`${kindKey}:${values.xraySubprotocol}`}
              kind={{ kindKey, subprotocol: values.xraySubprotocol, protocol: values.protocol, label: tile?.label ?? values.protocol }}
              profileId={profile?.id ?? null}
              values={{ ...values }}
              onApply={(recipe) => {
                if (draft !== null) {
                  const parsed = readDraft()
                  if (!parsed) return
                  setValues(parsed.values)
                  if (parsed.raw) setConsoleState({ base: fromForm(parsed.values), raw: parsed.raw })
                  setDraft(null)
                }
                setExampleOpen(false)
                applyRecipe(recipe)
              }}
              startOpen={!isEdit && search.get('from') === 'recipe'}
            />
          }
        />
      </div>
      {switchTo && <Confirm title={words.rebuildTitle} labels={{ confirm: words.rebuild, cancel: words.cancel }} onClose={() => setSwitchTo(null)} onConfirm={() => switchProtocol(switchTo)}>
        {words.rebuildBody}
      </Confirm>}
      {keyAsk && (
        <Confirm
          title={words.keyWindowTitle}
          labels={{ confirm: words.keyWindowAction, cancel: words.cancel }}
          onClose={() => setKeyAsk(null)}
          onConfirm={() => {
            setKeyAsk(null)
            runKeys()
          }}
        >
          {impact ? words.keyWindowBody(words.keyHosts(impact.hosts), words.keyNodes(impact.nodes), words.keyConfigs(impact.configs)) : words.keyWindowUnknown}
        </Confirm>
      )}
      {deleting && profile && (
        <Confirm
          title={words.deleteTitle(profile.name)}
          labels={{ confirm: words.delete, cancel: words.cancel }}
          state={{ busy: remove.isPending, error: remove.error ? failureText(remove.error, locale) : null }}
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            remove.mutate(profile.id, {
              onSuccess: () => {
                toast.show(words.deleted(profile.name))
                void navigate('/profiles')
              },
            })
          }
        >
          {(profile.bindingCount ?? 0) > 0 ? words.deleteWithHosts(profile.bindingCount ?? 0) : words.deleteSafe}
        </Confirm>
      )}
    </div>
  )
}

export default function ProfileFormPage() {
  const { id } = useParams()
  const words = useDict(DICT)
  const { locale } = useLocale()
  const navigate = useNavigate()
  const list = useProfilesList()
  const reviewConsole = import.meta.env.MODE === 'paper-review' && list.data !== undefined && 'reviewConsole' in list.data && list.data.reviewConsole === true
  if (!id) return <ProfileForm reviewConsole={reviewConsole} profile={null} onDone={(saved) => void navigate(`/profiles/${saved.id}`, { replace: true })} />
  if (list.isPending) return <QueryLoading label={words.loading} />
  if (list.isError) return <QueryFailed title={words.failedTitle} body={failureText(list.error, locale)} retryLabel={words.retry} onRetry={() => void list.refetch()} />
  const profile = list.data.profiles.find((p) => p.id === id)
  if (!profile) return <QueryFailed title={words.goneTitle} body={words.goneBody} retryLabel={words.backToList} onRetry={() => void navigate('/profiles')} />
  return <ProfileForm reviewConsole={reviewConsole} key={profile.id} profile={profile} onDone={() => undefined} />
}
