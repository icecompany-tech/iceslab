import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { isPayloadOnly, payloadFileName, payloadFileOf, scpCommand } from '@/contours/nodes/lib/payloadInstall'
import { useNow } from '@/lib/clock'
import { useLeaveGuard } from '@/lib/leaveGuard'
import { engineLabel } from '@/lib/domain/engines'
import { fmtDuration } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { findNode, type NodeWithPayload } from '@/lib/old/nodes'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Command } from '@/ui/Command/Command'
import { Confirm } from '@/ui/Dialog/Confirm'

const POLL_MS = 5000
const MINUTE_MS = 60_000

function savePayload(fileName: string, payload: string) {
  const url = URL.createObjectURL(new Blob([payload], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/** After the create: the one place the token or the payload is ever shown (F-29). */
export function InstallStep({ node }: { node: NodeWithPayload }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const now = useNow()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const [askClose, setAskClose] = useState(false)
  // The leave the window was asked about: the menu's, or null for «open the node».
  const [pending, setPending] = useState<{ go: () => void } | null>(null)
  const [started] = useState(() => now())
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const watched = useQuery({ queryKey: ['node', node.id, 'install'], queryFn: () => findNode(node.id), refetchInterval: (q) => (q.state.data?.cores ? false : POLL_MS) })
  const fresh = watched.data
  const reported = Boolean(fresh?.cores)
  const payloadOnly = isPayloadOnly(node.bootstrap)
  const fileName = payloadFileOf(node.bootstrap.command) ?? payloadFileName(node.name)
  const leave = () => void navigate(`/nodes/${node.id}`)
  // F-29: the menu, the sign-out and closing the tab ask too, not only the button below.
  useLeaveGuard(payloadOnly && !saved, (go) => {
    setPending({ go })
    setAskClose(true)
  })
  const minutesLeft = Math.ceil((Date.parse(node.bootstrap.expiresAt) - now()) / MINUTE_MS)

  if (reported && fresh) {
    const engines = fresh.engines ?? []
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>{words.reportedTitle(node.name)}</h1>
        <section className={styles.panel}>
          <p className={styles.note}>{engines.length > 0 ? words.reportedEngines(engines.map(engineLabel).join(', ')) : words.reportedNoEngines}</p>
          <Banner tone="info" title={words.noHostsYet} action={<Button onClick={() => void navigate('/hosts')}>{words.addHost}</Button>}>
            {words.willCreateBody}
          </Banner>
        </section>
        <div className={styles.actions}>
          <Button variant="primary" onClick={leave}>
            {words.openNode}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>
        {words.installTitle}: {node.name}
      </h1>
      {payloadOnly ? (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{words.noHttpsTitle}</h2>
          <p className={styles.note}>{words.noHttpsBody}</p>
          <ol className={styles.steps}>
            <li>
              <p>{words.stepDownload}</p>
              <Button
                variant={saved ? 'normal' : 'primary'}
                onClick={() => {
                  savePayload(fileName, node.payload)
                  setSaved(true)
                }}
              >
                {saved ? words.downloaded : words.download}
              </Button>
            </li>
            <li>
              <p>{words.stepUpload}</p>
              <Command text={scpCommand(node.name, node.address, fileName)} copyLabel={words.copy} copiedLabel={words.copied} />
            </li>
            <li>
              <p>{words.stepRun}</p>
              <Command text={node.bootstrap.command} copyLabel={words.copy} copiedLabel={words.copied} />
            </li>
          </ol>
        </section>
      ) : (
        <section className={styles.panel}>
          <p className={styles.note}>{words.installHttps}</p>
          <Command text={node.bootstrap.command} copyLabel={words.copy} copiedLabel={words.copied} />
          <p className={styles.note}>{minutesLeft > 0 ? words.tokenLeft(minutesLeft) : words.tokenGone}</p>
        </section>
      )}
      <section className={styles.panel}>
        <p className={styles.note}>
          {words.installWaiting} · {words.waited(fmtDuration((now() - started) / 1000, locale))}
        </p>
      </section>
      <div className={styles.actions}>
        <Button onClick={() => (payloadOnly && !saved ? setAskClose(true) : leave())}>{words.openNode}</Button>
      </div>
      {askClose && (
        <Confirm
          title={words.closeNoFileTitle}
          labels={{ confirm: words.closeAnyway, cancel: words.cancel }}
          onClose={() => {
            setAskClose(false)
            setPending(null)
          }}
          onConfirm={() => (pending ? pending.go() : leave())}
        >
          {words.closeNoFileBody}
        </Confirm>
      )}
    </div>
  )
}
