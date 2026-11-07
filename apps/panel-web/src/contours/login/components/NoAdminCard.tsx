import { useState } from 'react'
import styles from '@/contours/login/components/NoAdminCard.module.css'
import { DICT } from '@/contours/login/dict'
import { useDict } from '@/lib/i18n'
import { AuthCard } from '@/ui/AuthCard/AuthCard'
import { Button } from '@/ui/Button/Button'

export function NoAdminCard({ onDone }: { onDone: () => void }) {
  const words = useDict(DICT)
  const [copied, setCopied] = useState(false)
  return (
    <AuthCard title={words.noAdminTitle} subtitle={words.noAdminBody}>
      <code className={styles.command}>{words.noAdminCommand}</code>
      <p className={styles.note}>{words.noAdminNote}</p>
      <div className={styles.actions}>
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(words.noAdminCommand).then(() => setCopied(true))
          }}
        >
          {copied ? words.copied : words.copy}
        </Button>
        <Button variant="primary" onClick={onDone}>
          {words.checkAgain}
        </Button>
      </div>
    </AuthCard>
  )
}
