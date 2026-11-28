import { useState } from 'react'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { validCountryCode } from '@/contours/nodes/lib/nodeBody'
import { useDict, useLocale } from '@/lib/i18n'
import { localizedCountries } from '@/lib/old/countries'
import { Field, Input } from '@/ui/Field/Field'
import { Flag } from '@/ui/Flag/Flag'
import { Select } from '@/ui/Select/Select'

export function NodeCountry({ value, onChange, auto }: { value: string; onChange: (code: string) => void; auto?: boolean }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const [manual, setManual] = useState(false)
  const options = localizedCountries(locale)
  const other = value && !options.some(option => option.value === value)
    ? [{ value, label: new Intl.DisplayNames([locale], { type: 'region' }).of(value.padEnd(2, 'X')) ?? value }]
    : []
  return <div>
    <Field label={words.country} hint={auto && !manual ? words.countryAuto : undefined}>{a11y =>
      <div className={styles.countryPicker}>
        <Select {...a11y} value={manual ? '_' : value}
          options={[{ value: '', label: words.countryUnset }, ...other, ...options, { value: '_', label: words.countryOther }]}
          onChange={e => {
            const code = e.target.value
            setManual(code === '_')
            if (code !== '_') onChange(code)
          }} />
        {!manual && value && <span aria-hidden="true"><Flag code={value} /></span>}
      </div>
    }</Field>
    {manual && <Field label={words.countryOther} error={validCountryCode(value) ? undefined : words.countryBad}>{a11y =>
      <Input {...a11y} maxLength={2} value={value} onChange={e => onChange(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())} />
    }</Field>}
  </div>
}
