import { GEO_SET_KINDS } from '@iceslab/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from '@/contours/traffic/components/traffic.module.css'
import { DICT } from '@/contours/traffic/geoDict'
import { useAllNodes, useCreateSet, useRollout, useRolloutPlan, useUploadSet } from '@/contours/traffic/hooks/useGeoSets'
import { geoNameProblem, geoRolloutFacts, uploadProblem } from '@/contours/traffic/lib/geoFacts'
import { rolloutSilent } from '@/contours/traffic/lib/geoRolloutSilent'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { geoSetRefusal, type GeoSet, type GeoSetKind, type GeoUse } from '@/lib/old/geoSets'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Select } from '@/ui/Select/Select'
import { useToast } from '@/ui/Toast/useToast'

const SHA_RE = /^[0-9a-f]{64}$/
const DEFAULT_REFRESH_HOURS = 24
const KINDS = GEO_SET_KINDS.map((value) => ({ value, label: value }))

type ShaSource = 'sidecar' | 'manual'

function useRefusalWords() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  return (err: unknown) => {
    const read = geoSetRefusal(err)
    if (read?.code === 'GEO_SET_INVALID' && read.reason) return words.invalid[read.reason] ?? read.message ?? read.reason
    if (read?.code === 'GEO_SET_NAME_TAKEN') return words.nameTaken
    if (read?.code === 'GEO_SET_BUILTIN') return words.builtinNoDelete
    return read?.message ?? failureText(err, locale)
  }
}

interface CloseOnly {
  onClose: () => void
}

/** A set by link: sha256 from the sidecar file or by hand, a period in hours. The answer is 202, the check goes on in the list. */
export function AddUrlWindow({ onClose }: CloseOnly) {
  const words = useDict(DICT)
  const refusalWords = useRefusalWords()
  const create = useCreateSet()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GeoSetKind>('geosite')
  const [url, setUrl] = useState('')
  const [shaSource, setShaSource] = useState<ShaSource>('sidecar')
  const [sha, setSha] = useState('')
  const [hours, setHours] = useState(String(DEFAULT_REFRESH_HOURS))
  const [failure, setFailure] = useState<string | null>(null)
  const nameProblem = geoNameProblem(name.trim())
  const shaHex = sha.trim().toLowerCase()
  const shaBad = shaSource === 'manual' && !SHA_RE.test(shaHex)
  const period = Number(hours)
  const hoursBad = hours.trim() !== '' && (!Number.isInteger(period) || period < 1)
  const closed = nameProblem !== null || url.trim() === '' || shaBad || hoursBad
  const send = () => {
    setFailure(null)
    create.mutate(
      { name: name.trim(), kind, source: { type: 'url', url: url.trim(), sha256Source: shaSource, ...(shaSource === 'manual' ? { sha256: shaHex } : {}), ...(hours.trim() === '' ? {} : { refreshHours: period }) } },
      { onSuccess: onClose, onError: (err) => setFailure(`${words.addFailed}: ${refusalWords(err)}`) },
    )
  }
  return (
    <Dialog
      title={words.addTitle}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" loading={create.isPending} disabled={closed} onClick={send}>
            {words.addAction}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        <div className={styles.twoFields}>
          <Field label={words.name} error={name !== '' && nameProblem ? words.nameProblem[nameProblem] : undefined}>
            {(a11y) => <Input {...a11y} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={words.kind}>{(a11y) => <Select {...a11y} value={kind} options={KINDS} onChange={(e) => setKind(e.target.value as GeoSetKind)} />}</Field>
        </div>
        <div className={styles.threeFields}>
          <Field label={words.url}>{(a11y) => <Input {...a11y} placeholder="https://example.com/geosite.dat" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
          <Field label={words.refreshHours} error={hoursBad ? words.refreshHours : undefined}>
            {(a11y) => <Input {...a11y} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />}
          </Field>
        </div>
        <Segmented
          label={words.shaSource}
          value={shaSource}
          onChange={setShaSource}
          options={[
            { value: 'sidecar', label: words.shaSidecar },
            { value: 'manual', label: words.shaManual },
          ]}
        />
        {shaSource === 'manual' && (
          <Field label={words.sha} error={sha !== '' && shaBad ? words.shaBad : undefined}>
            {(a11y) => <Input {...a11y} value={sha} onChange={(e) => setSha(e.target.value)} />}
          </Field>
        )}
        <p className={styles.note}>{words.addHint}</p>
        {failure && <Banner tone="danger">{failure}</Banner>}
      </div>
    </Dialog>
  )
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Name and kind are asked here, not read off the file: geoip.dat may turn out to hold domains.
 * The name is guessed from the file name, in plain view and editable.
 */
export function UploadWindow({ onClose }: CloseOnly) {
  const words = useDict(DICT)
  const refusalWords = useRefusalWords()
  const toast = useToast()
  const upload = useUploadSet()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GeoSetKind>('geosite')
  const [file, setFile] = useState<File | null>(null)
  const [sum, setSum] = useState<{ file: File; hex: string } | null>(null)
  const [expected, setExpected] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const expectedHex = expected.trim().toLowerCase()
  const expectedBad = expectedHex !== '' && !SHA_RE.test(expectedHex)
  const nameProblem = geoNameProblem(name.trim())
  const fileProblem = uploadProblem(file)
  const current = file && sum?.file === file ? sum.hex : null
  const send = () => {
    if (!file) return
    setFailure(null)
    upload.mutate(
      { file, name: name.trim(), kind, ...(expectedHex ? { sha256: expectedHex } : {}) },
      {
        onSuccess: (set) => {
          // The check ran inside the request, so the outcome is known at once, in the server's words.
          if (set.status === 'verified') toast.show(words.uploadVerified(set.name))
          else toast.show(words.uploadBroken(set.name, set.error ?? words.noError), 'failed')
          onClose()
        },
        onError: (err) => setFailure(`${words.uploadFailed}: ${refusalWords(err)}`),
      },
    )
  }
  return (
    <Dialog
      title={words.uploadTitle}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" loading={upload.isPending} disabled={fileProblem !== null || nameProblem !== null || expectedBad} onClick={send}>
            {words.uploadAction}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        <Field label={words.file} error={fileProblem === 'too-large' ? words.tooLarge : undefined}>
          {(a11y) => (
            <input
              {...a11y}
              type="file"
              accept=".dat,.json,.mmdb"
              className={styles.fileInput}
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null
                setFile(picked)
                if (picked && !name)
                  setName(
                    picked.name
                      .replace(/\.[^.]+$/, '')
                      .toLowerCase()
                      .replace(/[^a-z0-9-]+/g, '-')
                      .slice(0, 32),
                  )
                if (picked && uploadProblem(picked) === null)
                  fileSha256(picked)
                    .then((hex) => setSum({ file: picked, hex }))
                    .catch(() => setSum(null))
              }}
            />
          )}
        </Field>
        <div className={styles.twoFields}>
          <Field label={words.name} error={name !== '' && nameProblem ? words.nameProblem[nameProblem] : undefined}>
            {(a11y) => <Input {...a11y} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={words.kind}>{(a11y) => <Select {...a11y} value={kind} options={KINDS} onChange={(e) => setKind(e.target.value as GeoSetKind)} />}</Field>
        </div>
        <Field label={words.expectedSha} error={expectedBad ? words.shaBad : undefined}>
          {(a11y) => <Input {...a11y} placeholder={words.expectedShaHolder} value={expected} onChange={(e) => setExpected(e.target.value)} />}
        </Field>
        {current && <p className={styles.mono}>{words.fileSha(current)}</p>}
        {/* A warning only: the server decides. */}
        {current && expectedHex !== '' && !expectedBad && <p className={expectedHex === current ? styles.ok : styles.amber}>{expectedHex === current ? words.expectedMatch : words.expectedMismatch}</p>}
        <p className={styles.note}>{words.uploadHint}</p>
        {failure && <Banner tone="danger">{failure}</Banner>}
      </div>
    </Dialog>
  )
}

/** Who holds a set, by name, and the way there. An unknown kind prints as it came: the operator still has to find it. */
export function InUseWindow({ uses, onClose }: { uses: readonly GeoUse[]; onClose: () => void }) {
  const words = useDict(DICT)
  return (
    <Dialog title={words.inUseTitle} closeLabel={words.close} onClose={onClose} footer={<Button onClick={onClose}>{words.close}</Button>}>
      <p>{words.inUseBody}</p>
      {uses.length === 0 && <p className={styles.note}>{words.usesUnnamed}</p>}
      <ul className={styles.linkList}>
        {uses.map((use) => {
          const label = words.useKind[use.kind]?.(use.name) ?? `${use.kind} ${use.name}`
          const to = use.kind === 'node-dns' ? `/nodes/${use.id}` : use.kind === 'node-policy' || use.kind === 'route-policy' ? '/routes' : null
          return (
            <li key={`${use.kind}-${use.id}`}>
              {to ? (
                <Link className={styles.link} to={to}>
                  {label}
                </Link>
              ) : (
                label
              )}
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}

/**
 * The plan first, then the button. Replacing a .dat restarts xray and drops sessions, so the window
 * names those nodes before the button; rule references to tags the version lacks close it.
 * A stale plan is reread and said, never sent as another version in silence.
 */
export function RolloutWindow({ set, onClose }: { set: GeoSet; onClose: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const plan = useRolloutPlan(set.id)
  const nodes = useAllNodes()
  const rollout = useRollout(set.id)
  const [failure, setFailure] = useState<string | null>(null)
  // Without the node list every restart is «maybe» (rolloutSilent).
  const silent = rolloutSilent((plan.data?.nodes ?? []).map((n) => n.id), nodes.data?.nodes)
  const facts = plan.data ? geoRolloutFacts(plan.data, silent) : null
  const send = () => {
    if (!facts) return
    setFailure(null)
    rollout.mutate(facts.version, {
      onSuccess: (result) => {
        toast.show(words.rollout.sent(result.nodes))
        onClose()
      },
      onError: (err) => {
        const read = geoSetRefusal(err)
        if (read?.code === 'GEO_ROLLOUT_STALE' || read?.code === 'GEO_ROLLOUT_BREAKS') {
          void plan.refetch()
          setFailure(read.code === 'GEO_ROLLOUT_STALE' ? words.rollout.stale : words.rollout.breaksNow)
          return
        }
        setFailure(failureText(err, locale))
      },
    })
  }
  return (
    <Dialog
      title={words.rollout.title(set.name)}
      closeLabel={words.close}
      size="window"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="warn" loading={rollout.isPending} disabled={!facts || facts.blocked || facts.sending.length === 0} onClick={send}>
            {words.rollout.confirm}
          </Button>
        </>
      }
    >
      <div className={styles.windowBody}>
        {plan.isPending && <QueryLoading label={words.rollout.loading} />}
        {plan.isError && (
          <QueryFailedLine retryLabel={words.retry} onRetry={() => void plan.refetch()}>
            {`${words.rollout.failedPlan}: ${failureText(plan.error, locale)}`}
          </QueryFailedLine>
        )}
        {facts && plan.data && (
          <>
            <p>{words.rollout.version(facts.version)}</p>
            {facts.restarts.length > 0 && <Banner tone="warn">{words.rollout.restarts(facts.restarts.join(', '), facts.restarts.length)}</Banner>}
            {facts.maybeRestarts.length > 0 && <Banner tone="warn">{words.rollout.maybeRestarts(facts.maybeRestarts.join(', '), facts.maybeRestarts.length)}</Banner>}
            {facts.sending.length > 0 ? (
              <div className={styles.tableBox}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{words.rollout.colNode}</th>
                      <th>{words.rollout.colPin}</th>
                      <th>{words.rollout.colFiles}</th>
                      <th>{words.rollout.colRestart}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.sending.map((node) => (
                      <tr key={node.id}>
                        <td>{node.name}</td>
                        <td className={styles.mono}>{`${node.from ?? words.rollout.noPin} → ${facts.version}`}</td>
                        <td>{words.rollout.files(node.filesToSend.length)}</td>
                        <td>{!node.restartsXray ? words.rollout.noRestart : silent.has(node.id) ? words.rollout.xrayMaybe : words.rollout.xray}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.noteRow}>{plan.data.nodes.length === 0 ? words.rollout.noNodes : words.rollout.nothing}</p>
            )}
            {facts.unchanged > 0 && <p className={styles.note}>{words.rollout.unchanged(facts.unchanged)}</p>}
            {facts.blocked && (
              <Banner tone="danger" title={words.rollout.breaks}>
                <ul className={styles.linkList}>
                  {plan.data.breaks.map((item) => (
                    <li key={item.entry}>
                      <span className={styles.mono}>{item.entry}</span> {item.uses.map((use) => words.useKind[use.kind]?.(use.name) ?? `${use.kind} ${use.name}`).join(', ')}
                    </li>
                  ))}
                </ul>
              </Banner>
            )}
          </>
        )}
        {failure && <Banner tone="danger">{failure}</Banner>}
      </div>
    </Dialog>
  )
}

