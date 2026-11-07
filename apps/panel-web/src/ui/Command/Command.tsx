import { useState } from 'react'
import { Button } from '@/ui/Button/Button'
import styles from '@/ui/Command/Command.module.css'

/** A line to run on a server, with copying on the button itself: no toast (design 06.11). */
export function Command({ text, copyLabel, copiedLabel }: { text: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.box}>
      <code className={styles.code}>{text}</code>
      <Button
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}
