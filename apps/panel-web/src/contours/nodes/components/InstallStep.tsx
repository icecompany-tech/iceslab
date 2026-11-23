import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { isPayloadOnly, payloadFileName, payloadFileOf, scpCommand } from '@/contours/nodes/lib/payloadInstall'
import { useNow } from '@/lib/clock'
import { useOverview } from '@/lib/domain/overview'
import { engineLabel } from '@/lib/domain/engines'
import { useDict } from '@/lib/i18n'
import { useLeaveGuard } from '@/lib/leaveGuard'
import { findNode, type NodeWithPayload } from '@/lib/old/nodes'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Command } from '@/ui/Command/Command'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Icon } from '@/ui/Icon/Icon'

const POLL_MS = 5000

function savePayload(name: string, payload: string) {
  const url = URL.createObjectURL(new Blob([payload], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function InstallStep({ node }: { node: NodeWithPayload }) {
  const words = useDict(DICT)
  const now = useNow()
  const navigate = useNavigate()
  const [started] = useState(now)
  const [time, setTime] = useState(started)
  const [downloaded, setDownloaded] = useState(false)
  const [pending, setPending] = useState<{ go: () => void } | null>(null)
  const watched = useQuery({
    queryKey: ['node', node.id, 'install'],
    queryFn: () => findNode(node.id),
    refetchInterval: query => query.state.data?.cores ? false : POLL_MS,
  })
  const overview = useOverview()
  const metrics = overview.data?.nodes.find(item => item.id === node.id)?.metrics
  const fresh = watched.data
  const report = fresh?.cores
  const fileOnly = isPayloadOnly(node.bootstrap)
  const guard = fileOnly && !downloaded && !report
  const openNode = () => { void navigate(`/nodes/${node.id}`) }
  useLeaveGuard(Boolean(guard), go => setPending({ go }))
  useEffect(() => {
    if (report) return
    const interval = setInterval(() => setTime(now()), 1000)
    return () => clearInterval(interval)
  }, [now, report])

  const save = () => {
    savePayload(payloadFileName(node.name), node.payload)
    setDownloaded(true)
    setPending(null)
  }
  const download = <Button variant={fileOnly ? "primary" : "normal"} onClick={save}>{downloaded ? words.downloaded : words.downloadPayload}</Button>
  const target = payloadFileOf(node.bootstrap.command) ?? payloadFileName(node.name)
  const command = (text: string, compact = false) => <Command compact={compact} text={text} copyLabel={words.copy} copiedLabel={words.copied} />
  const expiresIn = Math.ceil((Date.parse(node.bootstrap.expiresAt) - time) / 60000)
  const observed = report ? Date.parse(report.observedAt) : NaN
  const seconds = Math.max(0, Math.floor(((Number.isFinite(observed) ? observed : time) - started) / 1000))
  const elapsed = [Math.floor(seconds / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':')
  const steps = [
    [words.recordDone, words.recordHint],
    report ? [words.installed, words.installedHint] : fileOnly ? [words.fileRead, words.fileHint] : [words.tokenRead, words.tokenHint],
    report ? [words.reportDone, words.statusWord[fresh.status] ?? fresh.status] : [words.reportStep, words.reportHint],
  ]
  const engines = (fresh?.engines ?? []).map(engine => {
    const entry = report?.cores.find(core => (core.engine ?? core.name) === engine && core.version)
    return [engineLabel(engine), entry?.version].filter(Boolean).join(' ')
  })
  return (
    <div className={styles.install}>
      <header className={styles.installHead}>
        <h1 className={styles.pageTitle}>{report ? (fresh.status === 'online' ? words.reportedTitle(node.name) : node.name) : words.created(node.name)}</h1>
        <span className={styles.installStatus} data-reported={Boolean(report)}>{report ? words.firstSeen : words.waitAgent}</span>
        <Button size="md" variant="primary" onClick={() => guard ? setPending({ go: openNode }) : openNode()} icon={<Icon name={report ? 'arrowRight' : 'check'} />}>
          {report ? words.openNode : words.acknowledge}
        </Button>
      </header>
      <div className={styles.installColumns}>
        <div className={styles.installMain}>
          {report && fresh ? <>
            <section className={styles.installPanel}>
              <h2>{words.reportTitle}</h2>
              <dl className={styles.installFacts}>
                {[[words.address, fresh.address], [words.agentLabel, words.noVersion],
                  [words.coresStep, engines.join(', ') || words.noEngines],
                  [words.metricsLabel, metrics ? words.metricsSeen : words.noMetrics]].map(([label, value]) =>
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </section>
            <section className={styles.installOption}>
              <div><h2>{words.noHostsYet}</h2><p>{words.hostBody}</p></div>
              <Button icon={<Icon name="plus" />} onClick={() => void navigate('/hosts/new')}>{words.newHost}</Button>
            </section>
          </> : <>
            <Banner tone="warn" title={fileOnly ? words.noHttpsTitle : words.once}>{fileOnly ? words.noHttpsBody : words.onceBody}</Banner>
            {fileOnly ? <section className={styles.installPanel}>
              <h2>{words.fileTitle}</h2><p>{words.stepsHint}</p>
              <ol className={styles.installSteps} aria-label={words.fileTitle}>
                <li><h3>{words.downloadStep}</h3><p>{words.stepDownload}</p>{download}</li>
                <li><h3>{words.uploadStep}</h3>{command(scpCommand(node.name, node.address, target), true)}<p>{words.renameHint}</p></li>
                <li><h3>{words.runTitle}</h3>{command(node.bootstrap.command, true)}</li>
              </ol>
            </section> : <>
              <section className={`${styles.installPanel} ${styles.installCommand}`}>
                <h2>{words.runTitle}</h2><p>{words.sshHint} {expiresIn > 0 ? words.tokenLeft(expiresIn) : words.tokenGone}</p>
                {command(node.bootstrap.command)}
              </section>
              <section className={styles.installOption}>
                <div><h2>{words.fileTitle}</h2><p>{words.fileAlternative}</p></div>{download}
              </section>
            </>}
          </>}
        </div>
        <aside className={styles.installTimeline}>
          <h2>{report ? words.doneTitle : words.nextTitle}</h2>
          <ol>{steps.map(([title, body], index) => <li key={index}>
            <span className={styles.installMarker} data-state={report || index === 0 ? 'done' : index === 1 ? 'current' : 'next'} aria-hidden="true">
              {(report || index === 0) && <Icon name="check" />}
            </span>
            <div><strong>{title}</strong><p>{body}</p></div>
          </li>)}</ol>
          <div className={styles.installClock}><span>{report ? words.elapsed : words.waiting}</span><time>{elapsed}</time></div>
          {watched.isError && <p role="status">{words.fetchProblem}</p>}
        </aside>
      </div>
      {pending && <Dialog title={words.closeNoFileTitle} closeLabel={words.cancel} onClose={() => setPending(null)}
        footer={<><Button variant="danger" onClick={pending.go}>{words.closeAnyway}</Button><Button autoFocus variant="primary" onClick={save}>{words.downloadPayload}</Button></>}>
        {words.closeNoFileBody}
      </Dialog>}
    </div>
  )
}
