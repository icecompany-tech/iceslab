import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import { Menu } from '@/ui/Menu/Menu'
import { sessions } from './fixtures'
import { Question, Search, Table, Tabs } from './shared'
import { matches, useReviewValue, useSample } from './reviewState'
import styles from './review.module.css'

const labels: [string, string, string] = ['Все', 'Сняты, но на связи', 'Несколько адресов']
const columns = ['Юзер', 'Нода', 'Хост, протокол', 'Откуда', 'Начало', 'Трафик', 'Активность', '']

export default function Sessions() {
  const { sample, reset } = useSample()
  const [rows, setRows] = useReviewValue('sessions', sessions)
  const [filter, setFilter] = useState(labels[0])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<(typeof sessions)[number]>()
  const removed = rows.filter((row) => row[6].startsWith('снят'))
  const multiple = rows.filter((row) => rows.some((other) => other[0] === row[0] && other[3] !== row[3]))
  if (sample === 'offline') return <ReviewPageState title="Не удалось загрузить сессии" body="Сервер панели не ответил. На самих соединениях это не сказывается." retry={reset} />
  if (sample === 'empty' || !rows.length)
    return <ReviewPageState icon="monitor" title="Сейчас никого нет на связи" body="Здесь появятся живые соединения юзеров: с какой ноды, откуда и сколько трафика. Ноды отвечают, активных сессий на них нет." />
  const filtered = filter === labels[1] ? removed : filter === labels[2] ? multiple : rows
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Tabs
          labels={labels}
          counts={[rows.length, removed.length, multiple.length]}
          value={filter}
          change={setFilter}
        />
        <Search hint="Юзер, нода или адрес" value={search} change={setSearch} />
      </div>
      <Table
        columns={columns}
        note={
          filter === labels[1] &&
          'Ядро не рвёт соединения, открытые до снятия. Можно подождать клиента или перезапустить ядро ноды.'
        }
        rows={filtered
          .filter((row) => matches(row, search))
          .map((row) => ({
            id: row[1] + row[3],
            cells: [
              ...row,
              <Menu
                key="action"
                label={'Действия сессии ' + row[0]}
                items={[
                  {
                    id: 'disconnect',
                    label: 'Оборвать сессию',
                    icon: 'power',
                    tone: 'danger',
                    onSelect: () => setPicked(row),
                  },
                ]}
              />,
            ],
          }))}
      />
      {picked && (
        <Question
          title={'Оборвать сессию ' + picked[0] + '?'}
          cancel="Подождать клиента"
          accept="Перезапустить ядро"
          onClose={() => setPicked(undefined)}
          onAccept={() => {
            setRows(rows.filter((row) => row[1] !== picked[1]))
            setPicked(undefined)
          }}
        >
          Ядро умеет обрывать только все соединения ноды сразу. Перезапуск {picked[1]} затронет все её текущие
          соединения.
        </Question>
      )}
    </div>
  )
}
