import { useState } from 'react'
import { I18nProvider } from 'react-aria-components'
import styles from '@/app/TrialPage.module.css'
import { DateTimeField } from '@/ui/DateTimeField/DateTimeField'
import { SquadSelect } from '@/ui/SquadSelect/SquadSelect'

// The React Aria trial of DECISIONS 2026-10-30, until the shell and the first screen
// land. `?n=5000` is what the list costs at a size no frame draws.
const NAMES = ['basic', 'premium', 'premium-eu', 'prepaid', 'de-only', 'eu-fast', 'family', 'gaming', 'kz-partner']

function squads(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    name: NAMES[i] ?? `squad-${i}`,
    hint: `${(i % 9) + 1} профилей`,
  }))
}

const SIZE = Number(new URLSearchParams(window.location.search).get('n')) || 48
const OPTIONS = squads(SIZE)

const SELECT_TEXTS = {
  placeholder: 'All, другие не выбраны',
  search: 'Найти сквад',
  empty: 'Ничего не найдено',
  allGroup: 'Все сквады',
  clearAll: 'Снять все',
  clearSearch: 'Очистить поиск',
  remove: 'Убрать',
  selectedGroup: (n: number) => `Выбрано ${n}`,
  selectedFooter: (n: number, total: number) => `Выбрано ${n} из ${total}`,
  foundFooter: (n: number, total: number) => `Найдено ${n} из ${total}`,
}

const DATE_TEXTS = { open: 'Открыть календарь', previousMonth: 'Прошлый месяц', nextMonth: 'Следующий месяц' }

export default function TrialPage() {
  const [chosen, setChosen] = useState<string[]>(['s0', 's1'])
  const [until, setUntil] = useState<string | null>('2026-12-04T11:00:00.000Z')

  return (
    <I18nProvider locale="ru-RU">
      <main className={styles.page}>
        <SquadSelect label="Сквады" options={OPTIONS} value={chosen} onChange={setChosen} texts={SELECT_TEXTS} />
        <DateTimeField
          label="Срок"
          value={until}
          onChange={setUntil}
          timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          texts={DATE_TEXTS}
        />
        <output className={styles.state}>
          {chosen.length} / {until ?? 'без срока'}
        </output>
      </main>
    </I18nProvider>
  )
}
