import { Icon } from '@/ui/Icon/Icon'
import { changes, type ProfileError } from './text'
import { ColoredLine } from './ColoredLine'
import styles from './ProfileReview.module.css'

export function Editor({ text, error, edit, saved, fileName = 'config.json', clientsLabel = '1 204 юзера' }: { fileName?: string; clientsLabel?: string; saved: string; text: string; error: ProfileError | null; edit: (next: string) => void }) {
  const changed = changes(saved, text)
  return <div className={styles.editor}>
    <div aria-hidden="true">{text.split('\n').map((line,i) => {
      const managed = /^\s*"(tag|listen|port|clients)"\s*:/.test(line)
      return <div key={i} className={styles.line} data-changed={i >= changed.start && i < changed.start + changed.after.length || undefined} data-managed={managed || undefined} data-error={error?.line === i+1 || undefined}>
        <span className={styles.number}>{i+1}</span><code><ColoredLine line={line} /></code>
        {managed && <small>{line.includes('"port"') ? 'задаётся в хосте ' : line.includes('"clients"') ? clientsLabel + ' ' : ''}<Icon name="lock" size="sm" /></small>}
        {error?.line === i+1 && <small>{error.reason.includes('запятая') ? 'нужна запятая' : 'ошибка'}</small>}
      </div>
    })}</div>
    <textarea aria-label={fileName} spellCheck={false} wrap="off" value={text} onChange={event=>edit(event.target.value)} />
  </div>
}
