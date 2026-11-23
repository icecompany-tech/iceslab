import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import button from '@/ui/Button/Button.module.css'
import { Link } from 'react-router-dom'
import { Button } from '@/ui/Button/Button'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Field, Input } from '@/ui/Field/Field'
import { dns } from './fixtures'
import { Choice, Search, Table, Tabs } from './shared'
import { matches, useReviewValue, useSample } from './reviewState'
import styles from './review.module.css'

const labels: [string, string, string, string] = ['Все', 'Свои настройки', 'Как у ядра', 'Не дошло до ноды']
const families: [string, string, string, string] = ['Как у ядра', 'IPv4 и IPv6', 'Только IPv4', 'Только IPv6']
interface Conditions {
  domains: string
  ranges: string
  stop: boolean
}
const firstConditions: Record<string, Conditions> = {
  '77.88.8.8': { domains: 'geosite:category-ru\ndomain:yandex.ru', ranges: 'geoip:ru', stop: false },
}
const noConditions: Conditions = { domains: '', ranges: '', stop: false }
const initial = dns.map(([name, addresses, family, cache, status]) => ({
  name,
  servers: addresses.includes('ядра') ? [] : addresses.split(', '),
  family: families.find((v) => v.toLowerCase() === family.toLowerCase()) ?? families[0],
  cache: cache === 'да',
  status,
  conditions: name === 'aeza-de-01' ? firstConditions : ({} as Record<string, Conditions>),
}))
type NodeDns = (typeof initial)[number]

function validServer(text: string) {
  if (text.startsWith('https://')) {
    try {
      return Boolean(new URL(text).hostname)
    } catch {
      return false
    }
  }
  if (text.includes(':')) {
    try {
      new URL('http://[' + text + ']/')
      return true
    } catch {
      return false
    }
  }
  const parts = text.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export default function Dns() {
  const { sample, reset } = useSample()
  const [nodes, setNodes] = useReviewValue('dns', initial)
  const [filter, setFilter] = useState(labels[0])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<NodeDns>()
  const [dialog, setDialog] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [conditions, setConditions] = useState(noConditions)
  const [copy, setCopy] = useState('')
  if (sample === 'empty')
    return (
      <ReviewPageState icon="network" title="Нод пока нет" body="DNS настраивается на каждую ноду отдельно. Добавьте первую ноду, и она появится здесь.">
          <Link className={button.button + ' ' + button.normal + ' ' + button.sm} to="/nodes">Перейти к нодам</Link>
        </ReviewPageState>
    )
  if (sample === 'offline') return <ReviewPageState title="Не удалось загрузить DNS нод" body="Сервер панели не ответил. На нодах при этом всё работает как раньше." retry={reset} />
  if (draft)
    return (
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <h1>{draft.name}</h1>
          <span className={styles.muted}>DNS этой ноды</span>
          <span className={styles.push} />
          <Button onClick={() => setDraft(undefined)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              const status =
                sample === 'refused'
                  ? 'нода отказала'
                  : draft.name === 'ruvds-kz-01'
                    ? 'нода не на связи, ждём'
                    : 'применено только что'
              setNodes(nodes.map((node) => (node.name === draft.name ? { ...draft, status } : node)))
              setDraft(undefined)
            }}
          >
            Сохранить
          </Button>
        </div>
        <div className={styles.columns}>
          <div className={styles.stack}>
            <section className={styles.card}>
              <div className={styles.toolbar}>
                <h2>Резолверы по порядку</h2>
                <span className={styles.push} />
                <Button
                  onClick={() => {
                    setCopy(nodes.find((n) => n.name !== draft.name)?.name ?? '')
                    setDialog('copy')
                  }}
                >
                  Как на другой ноде
                </Button>
              </div>
              <p className={styles.muted}>Отвечает первый сервер с подходящим доменом.</p>
              {draft.servers.map((server, index) => (
                <div className={styles.line} key={server}>
                  <div>
                    {server}
                    {draft.conditions[server]?.domains && (
                      <small className={styles.muted}>
                        {' '}
                        · {draft.conditions[server]?.domains.replaceAll('\n', ', ')}
                      </small>
                    )}
                  </div>
                  <span className={styles.push} />
                  <Button
                    aria-label={'Убрать ' + server}
                    onClick={() => setDraft({ ...draft, servers: draft.servers.filter((_, i) => i !== index) })}
                  >
                    Убрать
                  </Button>
                </div>
              ))}
              {!draft.servers.length && <p>Как настроено у ядра</p>}
              <Button
                onClick={() => {
                  setValue('')
                  setConditions(noConditions)
                  setError('')
                  setDialog('add')
                }}
              >
                Добавить сервер
              </Button>
            </section>
            <section className={styles.card}>
              <h2>Какие адреса спрашивать</h2>
              <Choice
                label="Какие адреса спрашивать"
                options={families}
                value={draft.family}
                change={(family) => setDraft({ ...draft, family })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={!draft.cache}
                  onChange={(e) => setDraft({ ...draft, cache: !e.target.checked })}
                />{' '}
                Не кэшировать ответы
              </label>
            </section>
          </div>
          <aside className={styles.card}>
            <h2>Сводка</h2>
            <p>На ноде: {draft.status}</p>
            <p>Резолверов: {draft.servers.length}</p>
            <p>Адреса: {draft.family}</p>
            <p>Кэш: {draft.cache ? 'включён' : 'выключен'}</p>
          </aside>
        </div>
        {dialog && (
          <Dialog
            title={dialog === 'copy' ? 'Настроить как на другой ноде' : 'Новый резолвер'}
            closeLabel="Отмена"
            onClose={() => setDialog('')}
            footer={
              <>
                <Button onClick={() => setDialog('')}>Отмена</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (dialog === 'copy') {
                      const source = nodes.find((n) => n.name === copy)
                      if (source)
                        setDraft({
                          ...draft,
                          servers: [...source.servers],
                          family: source.family,
                          cache: source.cache,
                          conditions: { ...source.conditions },
                        })
                    } else {
                      const server = value.trim()
                      if (!validServer(server) || draft.servers.includes(server)) {
                        setError('Укажите новый IP или адрес DoH вида https://…')
                        return
                      }
                      setDraft({
                        ...draft,
                        servers: [...draft.servers, server],
                        conditions: { ...draft.conditions, [server]: conditions },
                      })
                    }
                    setDialog('')
                  }}
                >
                  {dialog === 'copy' ? 'Подставить' : 'Добавить'}
                </Button>
              </>
            }
          >
            {dialog === 'copy' ? (
              <Field label="Нода">
                {(props) => (
                  <select {...props} className={styles.control} value={copy} onChange={(e) => setCopy(e.target.value)}>
                    {nodes
                      .filter((n) => n.name !== draft.name)
                      .map((n) => (
                        <option key={n.name}>{n.name}</option>
                      ))}
                  </select>
                )}
              </Field>
            ) : (
              <div className={styles.stack}>
                <Field label="Адрес" hint="IP или адрес DoH вида https://…" error={error}>
                  {(props) => <Input {...props} value={value} onChange={(e) => setValue(e.target.value)} />}
                </Field>
                <Field label="Для каких доменов">
                  {(props) => (
                    <textarea
                      {...props}
                      className={styles.control}
                      value={conditions.domains}
                      onChange={(e) => setConditions({ ...conditions, domains: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Принимать ответы только из">
                  {(props) => (
                    <Input
                      {...props}
                      value={conditions.ranges}
                      onChange={(e) => setConditions({ ...conditions, ranges: e.target.value })}
                    />
                  )}
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={conditions.stop}
                    onChange={(e) => setConditions({ ...conditions, stop: e.target.checked })}
                  />{' '}
                  Отказ дальше не передавать
                </label>
              </div>
            )}
          </Dialog>
        )}
      </div>
    )
  const groups = [
    nodes,
    nodes.filter((n) => n.servers.length),
    nodes.filter((n) => !n.servers.length),
    nodes.filter((n) => n.status.includes('ждём')),
  ]
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Tabs labels={labels} counts={groups.map((g) => g.length)} value={filter} change={setFilter} />
        <Search hint="Нода или адрес" value={search} change={setSearch} />
      </div>
      <Table
        columns={['Нода', 'Резолверы по порядку', 'Какие адреса', 'Кэш', 'На ноде']}
        note="DNS настраивается на каждую ноду отдельно."
        rows={(groups[labels.indexOf(filter)] ?? nodes)
          .filter((n) => matches([n.name, ...n.servers], search))
          .map((n) => ({
            id: n.name,
            cells: [
              <button key="name" className={styles.link} onClick={() => setDraft({ ...n, servers: [...n.servers] })}>
                {n.name}
              </button>,
              n.servers.join(', ') || 'как настроено у ядра',
              n.family,
              n.cache ? 'да' : 'нет',
              n.status,
            ],
          }))}
      />
    </div>
  )
}
