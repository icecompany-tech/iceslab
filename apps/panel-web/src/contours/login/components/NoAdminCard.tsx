import styles from '@/contours/login/components/NoAdminCard.module.css'
import { DICT } from '@/contours/login/dict'
import { useDict } from '@/lib/i18n'
import { AuthCard } from '@/ui/AuthCard/AuthCard'
import { Button } from '@/ui/Button/Button'
import { Command } from '@/ui/Command/Command'

export function NoAdminCard({ onDone }: { onDone: () => void }) {
  const words = useDict(DICT)
  return (
    <AuthCard title={words.noAdminTitle} subtitle={words.noAdminBody}>
      <div className={styles.details}>
        <Command text={words.noAdminCommand} copyLabel={words.copy} copiedLabel={words.copied} compact />
        <p className={styles.note}>{words.noAdminNote}</p>
      </div>
      <Button variant="primary" size="md" wide onClick={onDone}>{words.checkAgain}</Button>
    </AuthCard>
  )
}
