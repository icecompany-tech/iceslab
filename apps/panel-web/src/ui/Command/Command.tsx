import { useState } from 'react'
import { Button } from '@/ui/Button/Button'
import styles from '@/ui/Command/Command.module.css'
import { Icon } from '@/ui/Icon/Icon'

interface CommandProps {
  text: string
  copyLabel: string
  copiedLabel: string
  compact?: boolean
}

export function Command({ text, copyLabel, copiedLabel, compact = false }: CommandProps) {
  const [copied, setCopied] = useState(false)
  const label = copied ? copiedLabel : copyLabel
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className={compact ? `${styles.box} ${styles.compact}` : styles.box}>
      <code className={styles.code}>{text}</code>
      {compact ? (
        <button type="button" className={styles.iconButton} aria-label={label} title={label} onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'copy'} size="md" />
        </button>
      ) : <Button onClick={() => void copy()}>{label}</Button>}
    </div>
  )
}
