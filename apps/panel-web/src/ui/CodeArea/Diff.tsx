import { ColoredLine } from './ColoredLine'
import { changes } from './text'
import styles from './ProfileReview.module.css'

export function Diff({ from, to, label, unchanged, compact }: { from: string; to: string; label: string; unchanged?: (count: number) => string; compact?: boolean }) {
  const diff = changes(from, to)
  const head = Math.max(0, diff.start - 1)
  const context = to.split('\n')
  function row(line: string, oldLine: number | null, newLine: number | null, kind?: 'added' | 'removed') {
    return <pre key={[oldLine, newLine].join('-')} data-kind={kind}>
      <span>{oldLine}</span><span>{newLine}</span><b>{kind === 'added' ? '+' : kind === 'removed' ? '-' : ''}</b><code><ColoredLine line={line} /></code>
    </pre>
  }
  return <div className={styles.diff} aria-label={label}>
    {unchanged && <p>{unchanged(head)}</p>}
    {diff.start > 0 && row(context[head] ?? '', diff.start, diff.start)}
    {diff.before.map((line,i) => row(line, diff.start+i+1, null, 'removed'))}
    {diff.after.map((line,i) => row(line, null, diff.start+i+1, 'added'))}
    {(compact ? diff.tail.slice(0,2) : diff.tail).map((line,i) => row(line, diff.start+diff.before.length+i+1, diff.start+diff.after.length+i+1))}
    {unchanged && compact && diff.tail.length>2 && <p>{unchanged(diff.tail.length-2)}</p>}
  </div>
}
