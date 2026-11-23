import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { Choice, Search, Tabs } from './shared'
import { matches, useReviewValue, useSample } from './reviewState'
import styles from './review.module.css'

const kinds: [string, string] = ['Домены', 'Адреса']
const sources: [string, string] = ['Вручную', 'По ссылке']
const initial = [
  {
    name: 'Банки РФ',
    id: 'banki-rf',
    kind: kinds[0],
    source: sources[0],
    entries: 'domain:sberbank.ru\ndomain:vtb.ru\nfull:tbank.ru\ndomain:alfabank.ru',
    url: '',
    hours: 24,
    count: 4,
    used: ['политика ноды «RU напрямую»', 'пресет устройства «Офис»'],
  },
  {
    name: 'Реклама плюс',
    id: 'reklama-plus',
    kind: kinds[0],
    source: sources[1],
    entries: '',
    url: 'https://lists.example.net/ads.txt',
    hours: 24,
    count: 1412,
    used: ['политика ноды «Без рекламы»', 'правила сквада «Без рекламы»'],
  },
  {
    name: 'Сети офиса',
    id: 'seti-ofisa',
    kind: kinds[1],
    source: sources[0],
    entries: '192.0.2.0/24\n198.51.100.0/24\n203.0.113.0/24',
    url: '',
    hours: 24,
    count: 3,
    used: [],
  },
]
type Rules = (typeof initial)[number]
const blank = (): Rules => ({
  name: '',
  id: '',
  kind: kinds[0],
  source: sources[0],
  entries: '',
  url: '',
  hours: 24,
  count: 0,
  used: [],
})
const filters: [string, string, string] = ['Все', kinds[0], kinds[1]]

function validate(draft: Rules) {
  if (draft.source === sources[1]) {
    try {
      if (new URL(draft.url).protocol === 'https:' && draft.hours >= 1 && Number.isInteger(draft.hours)) return ''
    } catch {
      /* show the field error */
    }
    return 'Укажите ссылку HTTPS и интервал в целых часах от 1.'
  }
  const lines = draft.entries.split(/\r?\n/)
  const index = lines.findIndex((raw) => {
    const line = raw.trim()
    if (!line) return false
    if (draft.kind === kinds[1]) return !/^[\da-fA-F.:]+(?:\/\d+)?$/.test(line)
    return !/^(?:(?:domain|full|keyword|regexp):.+|[\w.-]+)$/.test(line)
  })
  return index < 0 ? '' : 'Строка ' + (index + 1) + ': запись не разобрана. Набор не сохранён.'
}

export default function RuleSets() {
  const { sample, reset } = useSample()
  const [items, setItems] = useReviewValue('rule-sets', initial)
  const [draft, setDraft] = useState<Rules>(items[0] ?? blank())
  const [pending, setPending] = useState<Rules>()
  const [blocked, setBlocked] = useState(false)
  const [filter, setFilter] = useState(filters[0])
  const [search, setSearch] = useState('')
  const [issue, setIssue] = useState('')
  const [received, setReceived] = useState('')
  const select = (item: Rules) => {
    setDraft(item)
    setIssue('')
    setReceived('')
  }
  const create = () => {
    setPending(blank())
    setIssue('')
  }
  const fresh = () => {
    if (!pending?.name.trim() || items.some((item) => item.name === pending.name.trim())) {
      setIssue('Нужно свободное имя набора.')
      return
    }
    const next = { ...pending, name: pending.name.trim(), id: 'local-' + crypto.randomUUID().slice(0, 8) }
    setItems([...items, next])
    select(next)
    setPending(undefined)
    reset()
    setSearch('')
    setFilter(filters[0])
  }
  if (sample === 'offline') return <ReviewPageState title="Не удалось загрузить наборы" body="Сервер панели не ответил. Правила на нодах при этом работают как раньше." retry={reset} />
  const empty = sample === 'empty' || !items.length
  const shown = items.filter(
    (r) => (filter === filters[0] || r.kind === filter) && matches([r.name, r.entries], search),
  )
  return (
    <div className={styles.page}>
      {empty ? (
        <ReviewPageState icon="rules" title="Наборов пока нет" body="Набор это свой список доменов или адресов. Правила ссылаются на него по имени: поменяли список один раз, и правка дошла до всех правил.">
          <Button size="sm" variant="primary" onClick={create}>Новый набор</Button>
        </ReviewPageState>
      ) : (
        <>
          <div className={styles.toolbar}>
            <Tabs
              labels={filters}
              counts={[items.length, ...kinds.map((k) => items.filter((item) => item.kind === k).length)]}
              value={filter}
              change={setFilter}
            />
            <Search hint="Имя или запись" value={search} change={setSearch} />
            <Button variant="primary" onClick={create}>
              Новый набор
            </Button>
          </div>
          <div className={styles.split}>
            <aside className={styles.card}>
              <p className={styles.muted}>Свой список доменов или адресов. Правила ссылаются на него по имени.</p>
              {shown.map((item) => (
                <div key={item.id}>
                  <button className={styles.link} onClick={() => select(item)}>
                    {item.name}
                  </button>
                  <p className={styles.muted}>
                    {item.kind.toLowerCase()} · {item.count} записей
                  </p>
                </div>
              ))}
              {!shown.length && <p>Ничего не найдено</p>}
            </aside>
            {shown.some((item) => item.id === draft.id) && (
              <div className={styles.stack}>
                <div className={styles.toolbar}>
                  <h1>{draft.name}</h1>
                  <span className={styles.muted}>ruleset:{draft.id}</span>
                  <span className={styles.push} />
                  <Button
                    onClick={() => {
                      if (draft.used.length) {
                        setBlocked(true)
                        return
                      }
                      const left = items.filter((r) => r.id !== draft.id)
                      setItems(left)
                      select(left[0] ?? blank())
                    }}
                  >
                    Удалить
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const problem = validate(draft)
                      setIssue(problem)
                      if (problem) return
                      const next = {
                        ...draft,
                        count:
                          draft.source === sources[0]
                            ? draft.entries.split(/\r?\n/).filter((line) => line.trim()).length
                            : draft.count,
                      }
                      setItems(items.map((r) => (r.id === next.id ? next : r)))
                      setDraft(next)
                    }}
                  >
                    Сохранить
                  </Button>
                </div>
                <section className={styles.card}>
                  <h2>Что внутри</h2>
                  <Choice
                    label="Что внутри"
                    options={kinds}
                    value={draft.kind}
                    change={(kind) => setDraft({ ...draft, kind })}
                  />
                  <h3>Откуда</h3>
                  <Choice
                    label="Откуда"
                    options={sources}
                    value={draft.source}
                    change={(source) => setDraft({ ...draft, source })}
                  />
                  {draft.source === sources[0] ? (
                    <Field label="Записи, одна на строку" error={issue}>
                      {(props) => (
                        <textarea
                          {...props}
                          className={styles.control}
                          rows={7}
                          value={draft.entries}
                          onChange={(e) => setDraft({ ...draft, entries: e.target.value })}
                        />
                      )}
                    </Field>
                  ) : (
                    <>
                      <Field label="Ссылка на список" error={issue}>
                        {(props) => (
                          <Input
                            {...props}
                            value={draft.url}
                            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Раз в, ч">
                        {(props) => (
                          <Input
                            {...props}
                            type="number"
                            value={draft.hours}
                            onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })}
                          />
                        )}
                      </Field>
                      <Button
                        onClick={() =>
                          setReceived(
                            draft.url === initial[1]?.url && sample !== 'source-down'
                              ? 'Список забран: 1 412 записей'
                              : 'Список не забран: источник ответил 404',
                          )
                        }
                      >
                        Обновить сейчас
                      </Button>
                      {received && <p role="status">{received}</p>}
                    </>
                  )}
                </section>
                <section className={styles.card}>
                  <h2>Кто использует</h2>
                  {draft.used.length ? draft.used.map((label) => <p key={label}>{label}</p>) : <p>Нигде</p>}
                </section>
              </div>
            )}
          </div>
        </>
      )}
      {pending && (
        <Dialog
          title="Новый набор"
          closeLabel="Отмена"
          onClose={() => setPending(undefined)}
          footer={
            <>
              <Button onClick={() => setPending(undefined)}>Отмена</Button>
              <Button variant="primary" onClick={fresh}>
                Создать
              </Button>
            </>
          }
        >
          <div className={styles.stack}>
            <Field label="Имя" error={issue}>
              {(props) => (
                <Input
                  {...props}
                  value={pending.name}
                  onChange={(e) => setPending({ ...pending, name: e.target.value })}
                />
              )}
            </Field>
            <Choice
              label="Что внутри"
              options={kinds}
              value={pending.kind}
              change={(kind) => setPending({ ...pending, kind })}
            />
            <Choice
              label="Откуда"
              options={sources}
              value={pending.source}
              change={(source) => setPending({ ...pending, source })}
            />
          </div>
        </Dialog>
      )}
      {blocked && (
        <Dialog
          title={'Набор «' + draft.name + '» удалить нельзя'}
          closeLabel="Понятно"
          onClose={() => setBlocked(false)}
          footer={<Button onClick={() => setBlocked(false)}>Понятно</Button>}
        >
          <p>Он в {draft.used.length} правилах. Сначала уберите его оттуда.</p>
          {draft.used.map((label) => (
            <p key={label}>
              {label} <Link to="/routes">Открыть</Link>
            </p>
          ))}
        </Dialog>
      )}
    </div>
  )
}
