import { useState, type ReactNode } from 'react'
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
import { squadsLosingLastHost, useSquads } from '@/lib/domain/squads'
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

function ProfileForm({ profile, onDone }: { profile: Profile | null; onDone: (saved: Profile) => void }) {
  const words = useDict(DICT)
  const recipeWords = useDict(RECIPE_DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const isEdit = profile !== null
  const [initial, setInitial] = useState<FormValues>(() => settleXrayFields(defaults(profile)))
  const [values, setValues] = useState<FormValues>(initial)
  const [open, setOpen] = useState<string | null>(isEdit ? null : 'protocol')
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
  const changed = profile ? Object.keys(body ?? {}).length > 0 : true
  // An old row the operator did not touch must not close a rename: its config is not sent.
  const configTouched = !profile || JSON.stringify(profileConfigOf(values)) !== JSON.stringify(profileConfigOf(initial))
  const blocked = problems.name !== undefined || (configTouched && Object.keys(problems).length > 0)
  const tile = tileOf(values)
  const kindKey = profileKindKey(values.protocol, values.engine, values.xraySubprotocol)
  const pickTile = (next: Tile) => {
    const fresh = settleXrayFields({ ...defaults(null), name: values.name, description: values.description, protocol: next.protocol, engine: next.engine ?? 'native', ...(next.subprotocol ? { xraySubprotocol: next.subprotocol } : {}) })
    setValues({ ...fresh, ...singboxXrayPatch(fresh) })
  }
  const setEngine = (engine: FormValues['engine']) => {
    const next = { ...values, engine }
    setValues({ ...next, ...singboxXrayPatch(next) })
  }
  const hasEngineChoice = !tile?.engine && ENGINE_CHOICE_PROTOCOLS.includes(values.protocol) && !isPlainSubprotocol(values.xraySubprotocol)

  const afterSave = async (saved: Profile) => {
    // E23 by the old request after the save (6.6): a refusal stands at the field.
    if (saved.protocol === 'xray' && values.xraySecurity === 'reality' && values.xrayRealityMode === 'steal-others') {
      const refused = await check.mutateAsync(saved.id).catch(() => [])
      const first = refused[0]
      if (first) {
        setDestError(destWords(first, words))
        setOpen('masquerade')
        toast.show(words.savedDestRefused, 'partial')
        if (!isEdit) onDone(saved)
        return
      }
    }
    toast.show(isEdit ? words.saved : words.createdDone(saved.name))
    onDone(saved)
  }

  const submit = () => {
    const onError = (err: unknown) => setRefusal(failureText(err, locale))
    if (profile && body) {
      update.mutate(body, {
        onSuccess: (saved) => {
          setInitial(values)
          void afterSave(saved)
        },
        onError,
      })
    } else {
      create.mutate(createBody(values), { onSuccess: (saved) => void afterSave(saved), onError })
    }
  }

  const impact = keyAsk?.kind === 'confirm' ? keyAsk.impact : null
  const myBindings = new Set((bindings.data?.bindings ?? []).filter((b) => b.profileId === profile?.id).map((b) => b.id))
  const lastOf = squadsLosingLastHost((hosts.data?.hosts ?? []).filter((h) => myBindings.has(h.bindingId)).map((h) => h.id), squads.data ?? [])
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{profile ? profile.name : words.newProfile}</h1>
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{words.stepName}</h2>
            <div className={styles.twoFields}>
              <Field label={words.name} error={problems.name === 'required' ? words.nameRequired : problems.name === 'latin' ? words.nameRequired : undefined}>
                {(a11y) => <Input {...a11y} autoFocus={!isEdit} value={values.name} onChange={(e) => patch({ name: e.target.value })} />}
              </Field>
              <Field label={words.description}>{(a11y) => <Input {...a11y} placeholder={words.descriptionPlaceholder} value={values.description} onChange={(e) => patch({ description: e.target.value })} />}</Field>
            </div>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={values.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
              {words.enabled}
            </label>
          </section>
          <Step title={words.stepProtocol} open={open === 'protocol'} onToggle={() => setOpen(open === 'protocol' ? null : 'protocol')} value={tile?.label ?? values.protocol}>
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
          </Step>
          {hasEngineChoice && (
            <Step title={words.stepEngine} open={open === 'engine'} onToggle={() => setOpen(open === 'engine' ? null : 'engine')} value={values.engine === 'singbox' ? words.engineSingbox : words.engineNative}>
              <RadioRow name="engine" title={words.engineNative} checked={values.engine === 'native'} onSelect={() => setEngine('native')} />
              <RadioRow name="engine" title={words.engineSingbox} description={values.protocol === 'xray' ? words.singboxOnlyReality : undefined} checked={values.engine === 'singbox'} closedReason={values.xraySubprotocol === 'vmess' && values.protocol === 'xray' ? words.onlyVlessTrojan : undefined} onSelect={() => setEngine('singbox')} />
            </Step>
          )}
          {steps.map((step) =>
            step.faded ? (
              <section key={step.id} className={styles.fadedStep}>
                <span>{step.title}</span>
                <span>{step.faded}</span>
              </section>
            ) : (
              <Step key={step.id} title={step.title} optional={step.optional} value={step.invalid ? <span className={styles.danger}><Icon name="warn" size="sm" /></span> : step.value} open={open === step.id} onToggle={() => setOpen(open === step.id ? null : step.id)}>
                {step.body}
              </Step>
            ),
          )}
          {refusal && <Banner tone="danger">{refusal}</Banner>}
          <div className={styles.actions}>
            {profile && (
              <Button variant="danger" disabled={lastOf.length > 0} title={lastOf.length > 0 ? words.deleteLastHost(lastOf.join(', ')) : undefined} onClick={() => setDeleting(true)}>
                {words.delete}
              </Button>
            )}
            {lastOf.length > 0 && <span className={styles.lastHost}>{words.deleteLastHost(lastOf.join(', '))}</span>}
            <span className={styles.spacer} />
            <Button onClick={() => void navigate('/profiles')}>{words.cancel}</Button>
            <Button variant="primary" disabled={!changed || blocked} loading={create.isPending || update.isPending || check.isPending} onClick={submit}>
              {isEdit ? words.save : words.create}
            </Button>
          </div>
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
              onApply={applyRecipe}
              startOpen={!isEdit && search.get('from') === 'recipe'}
            />
          }
        />
      </div>
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
  if (!id) return <ProfileForm profile={null} onDone={(saved) => void navigate(`/profiles/${saved.id}`, { replace: true })} />
  if (list.isPending) return <QueryLoading label={words.loading} />
  if (list.isError) return <QueryFailed title={words.failedTitle} body={failureText(list.error, locale)} retryLabel={words.retry} onRetry={() => void list.refetch()} />
  const profile = list.data.profiles.find((p) => p.id === id)
  if (!profile) return <QueryFailed title={words.goneTitle} body={words.goneBody} retryLabel={words.backToList} onRetry={() => void navigate('/profiles')} />
  return <ProfileForm key={profile.id} profile={profile} onDone={() => undefined} />
}
