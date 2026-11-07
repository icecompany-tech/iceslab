import type { StepProps } from '@/contours/profiles/components/ProtocolSteps'
import styles from '@/contours/profiles/components/profiles.module.css'
import { DICT } from '@/contours/profiles/dict'
import { useDict } from '@/lib/i18n'
import { Button } from '@/ui/Button/Button'
import { Field, Input, PasswordInput } from '@/ui/Field/Field'

type Words = { showSecret: string; hideSecret: string }
export function Secret({ label, value, onChange, words, hint }: { label: string; value: string; onChange: (next: string) => void; words: Words; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(a11y) => <PasswordInput {...a11y} showLabel={words.showSecret} hideLabel={words.hideSecret} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  )
}

export function Keys({ props, privateKey, publicKey, onPrivate, onPublic, publicPlaceholder }: { props: StepProps; privateKey: string; publicKey: string; onPrivate: (v: string) => void; onPublic: (v: string) => void; publicPlaceholder?: string }) {
  const words = useDict(DICT)
  return (
    <>
      <div className={styles.keyRow}>
        <Secret label={words.privateKey} value={privateKey} onChange={onPrivate} words={words} />
        <Button variant={props.isEdit ? 'warn' : 'primary'} loading={props.generating} onClick={props.onGenerate}>
          {props.isEdit ? words.newPair : words.generate}
        </Button>
      </div>
      <Field label={words.publicKey}>{(a11y) => <Input {...a11y} placeholder={publicPlaceholder} value={publicKey} onChange={(e) => onPublic(e.target.value)} />}</Field>
    </>
  )
}
