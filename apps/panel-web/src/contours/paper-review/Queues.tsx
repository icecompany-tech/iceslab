import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import { Button } from '@/ui/Button/Button'
import { jobs, queues } from './fixtures'
import { Empty, Question, Table, Tabs } from './shared'
import { useReviewValue, useSample } from './reviewState'
import styles from './review.module.css'

const filters: [string, string, string] = ['Все', 'С упавшими', 'На паузе']
const failedTabs: [string, string, string, string, string] = ['Упали', 'Ждут', 'В работе', 'Отложены', 'Готово']

export default function Queues() {
  const { sample, reset } = useSample()
  const [rows, setRows] = useReviewValue('queues', queues)
  const [failed, setFailed] = useReviewValue('queue-jobs', jobs)
  const [filter, setFilter] = useState(filters[0])
  const [picked, setPicked] = useState('')
  const [tab, setTab] = useState(failedTabs[0])
  const [detail, setDetail] = useState('')
  const [confirm, setConfirm] = useState(false)
  const queue = rows.find((row) => row[0] === picked)
  const faultyQueue = 'Юзеры на нодах'
  const update = (row: (typeof queues)[number]) => setRows(rows.map((old) => (old[0] === row[0] ? row : old)))
  const clear = (retry: boolean) => {
    if (!queue || queue[0] !== faultyQueue) return
    const next: typeof queue = [...queue]
    next[5] = '0'
    if (retry) next[2] = String(Number(queue[2]) + failed.length)
    setFailed([])
    update(next)
    setConfirm(false)
    setDetail('')
  }
  if (sample === 'offline') return <ReviewPageState title="Redis недоступен" body="Очереди живут в Redis, панель до него не достучалась. Пока он не вернётся, новые задачи не ставятся и не выполняются." retry={reset} />
  if (queue) {
    const onPause = queue[7] === 'на паузе'
    const counts = [queue[5], queue[2], queue[3], queue[4], queue[6]].map((cell) => Number(cell.replaceAll(' ', '')))
    const tasks = queue[0] === faultyQueue ? failed : []
    return (
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <Button onClick={() => setPicked('')}>К очередям</Button>
          <h1>{queue[0]}</h1>
          <span className={styles.muted}>{queue[1].split(':')[0]}</span>
          <span className={styles.push} />
          <Button disabled={!tasks.length} onClick={() => setConfirm(true)}>
            Очистить
          </Button>
          <Button
            onClick={() => {
              const next: typeof queue = [...queue]
              next[7] = onPause ? 'работает' : 'на паузе'
              update(next)
            }}
          >
            {onPause ? 'Продолжить' : 'Пауза'}
          </Button>
          <Button variant="primary" disabled={!tasks.length} onClick={() => clear(true)}>
            Повторить упавшие
          </Button>
        </div>
        {onPause && <p className={styles.note}>Очередь на паузе. Новые задачи ждут возобновления.</p>}
        <div className={styles.line}>
          <Tabs labels={failedTabs} counts={counts} value={tab} change={setTab} />
        </div>
        {tab !== failedTabs[0] ? (
          <Empty title={tab}>
            {counts[failedTabs.indexOf(tab)]} задач. Подробности в тестовом наборе есть для упавших задач.
          </Empty>
        ) : !tasks.length ? (
          <Empty title="Упавших задач нет" />
        ) : (
          <Table
            columns={['Задача', 'Что делает', 'Попыток', 'Упала', 'Почему']}
            rows={tasks.map((row) => ({
              id: row[0],
              cells: [
                <button
                  key="details"
                  aria-expanded={detail === row[0]}
                  className={styles.link}
                  onClick={() => setDetail(detail === row[0] ? '' : row[0])}
                >
                  #{row[0]}
                </button>,
                ...row.slice(1),
              ],
              detail: detail === row[0] && (
                <div className={styles.detail}>
                  <strong>Ошибка последней попытки</strong>
                  <p>{row[4]}</p>
                  <p>
                    {row[1]} · {row[2]}
                  </p>
                </div>
              ),
            }))}
          />
        )}
        {confirm && (
          <Question
            title="Очистить упавшие задачи?"
            accept={'Очистить ' + tasks.length + ' задачи'}
            onClose={() => setConfirm(false)}
            onAccept={() => clear(false)}
          >
            Задачи очереди «{queue[0]}» удалятся без повтора.
          </Question>
        )}
      </div>
    )
  }
  const crashed = rows.filter((row) => row[5] !== '0')
  const paused = rows.filter((row) => row[7] === 'на паузе')
  const filtered = filter === filters[1] ? crashed : filter === filters[2] ? paused : rows
  return (
    <div className={styles.page + ' ' + styles.queues}>
      <div className={styles.toolbar}>
        <Tabs
          labels={filters}
          counts={[rows.length, crashed.length, paused.length]}
          value={filter}
          change={setFilter}
        />
      </div>
      <Table
        columns={['Очередь', 'Ждут', 'В работе', 'Отложены', 'Упали', 'Готово, 24 ч', 'Состояние']}
        rows={filtered.map((row) => ({
          id: row[0],
          cells: [
            <div key="name">
              <button
                className={styles.link}
                onClick={() => {
                  setPicked(row[0])
                  setTab(failedTabs[0])
                  setDetail('')
                }}
              >
                {row[0]}
              </button>
              <small>{row[1]}</small>
            </div>,
            ...row.slice(2),
          ],
        }))}
      />
    </div>
  )
}
