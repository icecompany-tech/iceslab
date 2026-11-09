import { useState } from 'react'
import styles from '@/contours/users/components/users.module.css'
import { DICT } from '@/contours/users/dict'
import { useEstimateSources } from '@/contours/users/hooks/useUsers'
import { estimateConfigs } from '@/contours/users/lib/estimate'
import { PRESET_NAME_MAX } from '@/contours/users/lib/presets'
import type { NodeRow } from '@/lib/domain/nodes'
import type { Squad } from '@/lib/domain/squads'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { Flag } from '@/ui/Flag/Flag'
import { QueryFailedLine, QueryLoading } from '@/ui/QueryState/QueryState'

export interface EstimateBlockProps {
  picked: readonly string[]
  squads: readonly Squad[]
  nodes: ReadonlyMap<string, NodeRow>
}

/** Right side of the new user window: the configs this user would get, said to be a guess. */
export function EstimateBlock({ picked, squads, nodes }: EstimateBlockProps) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const { profiles, bindings, hosts } = useEstimateSources()
  const failed = [profiles, bindings, hosts].find((q) => q.isError)
  const ready = profiles.data && bindings.data && hosts.data
  const rows = ready ? estimateConfigs({ picked, squads, profiles: profiles.data.profiles, bindings: bindings.data.bindings, hosts: hosts.data.hosts, nodes }) : []
  const nodeCount = new Set(rows.map((r) => r.nodeId)).size
  const protocolCount = new Set(rows.map((r) => r.protocol)).size
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockTitle}>{words.clientGets}</h3>
        <span className={styles.blockAside}>{words.estimateLabel}</span>
      </div>
      {failed && (
        <QueryFailedLine retryLabel={words.retry} onRetry={() => void failed.refetch()}>
          {words.estimateFailed}: {failureText(failed.error, locale)}
        </QueryFailedLine>
      )}
      {!failed && !ready && <QueryLoading label={words.estimateLoading} />}
      {ready && !failed && rows.length === 0 && <div className={styles.grayLine}>{words.estimateEmpty}</div>}
      {ready && !failed && rows.length > 0 && (
        <>
          <div className={styles.configCount}>{words.configsCount(words.configsWord(rows.length), words.nodesWord(nodeCount), words.protocolsWord(protocolCount))}</div>
          <div className={`${styles.innerTable} ${styles.configScroll}`}>
            <table className={styles.devices}>
              <thead>
                <tr>
                  <th scope="col">{words.configNode}</th>
                  <th scope="col">{words.configProtocol}</th>
                  <th scope="col">{words.configPort}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className={styles.nodeCell}>
                        <Flag code={row.countryCode} />
                        <span className={styles.nodeName}>{row.nodeName}</span>
                      </span>
                    </td>
                    <td className={styles.mono}>{row.protocol}</td>
                    <td className={`${styles.mono} ${styles.muted}`}>{row.port}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className={styles.grayLine}>{words.newConfigsNote}</div>
    </section>
  )
}

export interface SavePresetProps {
  summary: string
  taken: (name: string) => boolean
  onSave: (name: string) => void
  onClose: () => void
}

/** Kept in this browser, as in the old panel: the server has no tariff presets. */
export function SavePresetWindow({ summary, taken, onSave, onClose }: SavePresetProps) {
  const words = useDict(DICT)
  const [name, setName] = useState('')
  const typed = name.trim()
  const tooLong = typed.length > PRESET_NAME_MAX
  return (
    <Dialog
      title={words.presetSaveTitle}
      closeLabel={words.close}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{words.cancel}</Button>
          <Button variant="primary" disabled={typed === '' || tooLong} onClick={() => onSave(typed)}>
            {words.save}
          </Button>
        </>
      }
    >
      <p className={styles.grayLine}>{summary}</p>
      <Field label={words.presetName} error={tooLong ? words.presetNameLong(PRESET_NAME_MAX) : undefined} hint={!tooLong && taken(typed) ? words.presetNameTaken : words.presetBrowserNote}>
        {(a11y) => <Input {...a11y} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </Dialog>
  )
}
