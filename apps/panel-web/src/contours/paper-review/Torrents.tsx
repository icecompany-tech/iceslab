import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import { Button } from '@/ui/Button/Button'
import { Menu } from '@/ui/Menu/Menu'
import { Field, Input } from '@/ui/Field/Field'
import { torrents } from './fixtures'
import { Choice, Question, Search, Table, Tabs } from './shared'
import { matches, useReviewValue, useSample } from './reviewState'
import styles from './review.module.css'

const policies: [string, string, string] = ['Только записывать', 'Сообщить мне в Telegram', 'Отключить юзера']
const periods: [string, string, string] = ['24 ч', '7 дн', '30 дн']
const initial = { recording: true, days: 30, threshold: 100, interval: '1 час', action: policies[2] }
const labels: [string, string] = ['Все', 'Отключены']

export default function Torrents() {
  const { sample, reset } = useSample()
  const [settings, save] = useReviewValue('torrent-settings', initial)
  const [rows, setRows] = useReviewValue('torrent-rows', torrents)
  const [form, setForm] = useState(settings)
  const [editing, setEditing] = useState(false)
  const [issue, setIssue] = useState('')
  const [filter, setFilter] = useState(labels[0])
  const [period, setPeriod] = useState(periods[1])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState('')
  const edit = () => {
    setForm(settings)
    setIssue('')
    setEditing(true)
  }
  if (sample === 'offline') return <ReviewPageState title="Не удалось загрузить попытки" body="Сервер панели не ответил. Торренты при этом режутся как обычно." retry={reset} />
  if (editing)
    return (
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <h1>Настройка</h1>
          <span className={styles.muted}>запись попыток и что делать дальше</span>
          <span className={styles.push} />
          <Button onClick={() => setEditing(false)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (
                !Number.isSafeInteger(form.threshold) ||
                form.threshold < 1 ||
                !Number.isSafeInteger(form.days) ||
                form.days < 1
              ) {
                setIssue('Порог и срок хранения должны быть целыми числами от 1.')
                return
              }
              save(form)
              reset()
              setEditing(false)
            }}
          >
            Сохранить
          </Button>
        </div>
        <div className={styles.columns}>
          <div className={styles.card}>
            <h2>Записывать попытки</h2>
            <label>
              <input
                type="checkbox"
                checked={form.recording}
                onChange={(e) => setForm({ ...form, recording: e.target.checked })}
              />{' '}
              Запись попыток
            </label>
            <Field label="Хранить, дней">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
                />
              )}
            </Field>
            <h2>Когда кто-то пытается снова и снова</h2>
            <Choice
              label="Действие при пороге"
              options={policies}
              value={form.action}
              change={(action) => setForm({ ...form, action })}
            />
            <Field label="Попыток" error={issue}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                />
              )}
            </Field>
            <Field label="За какое время">
              {(props) => (
                <select
                  {...props}
                  className={styles.control}
                  value={form.interval}
                  onChange={(e) => setForm({ ...form, interval: e.target.value })}
                >
                  <option>1 час</option>
                  <option>24 часа</option>
                </select>
              )}
            </Field>
          </div>
          <aside className={styles.card}>
            <h2>Сводка</h2>
            <p>Торренты режутся всегда</p>
            <p>Запись: {form.recording ? form.days + ' дней' : 'выключена'}</p>
            <p>При пороге: {form.action}</p>
          </aside>
        </div>
      </div>
    )
  if (sample === 'empty') return <ReviewPageState icon="block" title="Попыток не было" body="За последние 7 дней никто не пытался качать торренты. Сами торренты режутся на всех нодах всегда, запись только показывает, кто пытался." />
  if (!settings.recording || sample === 'disabled')
    return (
      <ReviewPageState icon="block" title="Запись выключена" body="Торренты всё равно режутся на всех нодах, но кто пытался, панель не запоминает.">
          <Button size="sm" onClick={edit}>Открыть настройку</Button>
        </ReviewPageState>
    )
  const recent = period === periods[0] ? rows.filter((row) => row[1].startsWith('сегодня')) : rows
  const stopped = recent.filter((row) => row[5].startsWith('отключён'))
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Choice label="Период" options={periods} value={period} change={setPeriod} />
        <Tabs labels={labels} counts={[recent.length, stopped.length]} value={filter} change={setFilter} />
        <Search hint="Юзер или нода" value={search} change={setSearch} />
        <Button onClick={edit}>Настройка</Button>
      </div>
      <Table
        columns={['Юзер', 'Последняя попытка', 'Нода', 'Ядро', 'Попыток', 'Что сделано', '']}
        note="BitTorrent режется на всех нодах всегда, выключить нельзя. Здесь показаны попытки."
        rows={(filter === labels[0] ? recent : stopped)
          .filter((row) => matches(row, search))
          .map((row) => ({
            id: row[0],
            cells: [
              ...row,
              <Menu
                key="action"
                label={'Действия юзера ' + row[0]}
                items={[
                  {
                    id: 'disable',
                    label: 'Отключить юзера',
                    icon: 'ban',
                    tone: 'danger',
                    disabledReason: row[5].startsWith('отключён') ? 'Юзер уже отключён' : undefined,
                    onSelect: () => setPicked(row[0]),
                  },
                ]}
              />,
            ],
          }))}
      />
      {picked && (
        <Question
          title={'Отключить ' + picked + '?'}
          accept="Отключить"
          onClose={() => setPicked('')}
          onAccept={() => {
            setRows(
              rows.map((row) => {
                const next: typeof row = [...row]
                if (next[0] === picked) next[5] = 'отключён оператором'
                return next
              }),
            )
            setPicked('')
          }}
        >
          Подписка перестанет работать на всех устройствах юзера. Открытые соединения могут оставаться активными.
        </Question>
      )}
    </div>
  )
}
