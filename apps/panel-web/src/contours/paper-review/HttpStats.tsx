import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import { Chip } from '@/ui/Chip/Chip'
import { http } from './fixtures'
import { Choice, Search, Table } from './shared'
import { matches, useSample } from './reviewState'
import styles from './review.module.css'

const periods: [string, string, string] = ['1 ч', '24 ч', '7 дн']
const hours = [26, 24, 22, 22, 24, 30, 38, 46, 52, 56, 54, 50, 48, 52, 60, 68, 74, 66, 58, 50, 42, 36, 32, 28]
const errorsByHour: Record<number, number> = { 14: 8, 15: 18, 16: 12 }
const scales: Record<string, number> = { '1 ч': 1 / 24, '24 ч': 1, '7 дн': 7 }
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(Math.round(value))
const count = (cell: string) => Number(cell.replaceAll(' ', ''))

export default function HttpStats() {
  const { sample, reset } = useSample()
  const [period, setPeriod] = useState(periods[1])
  const [errors, setErrors] = useState(false)
  const [search, setSearch] = useState('')
  if (sample === 'empty')
    return <ReviewPageState icon="chart" title="Метрик пока нет" body="Панель считает запросы к своему API с момента запуска. После перезапуска счёт начинается заново: подождите первых запросов." />
  if (sample === 'offline') return <ReviewPageState title="Не удалось загрузить метрики" body="Сервер панели не ответил. Повторите запрос, статистика не пропадёт." retry={reset} />
  const scale = scales[period] ?? 1
  const flagged = http.filter((row) => ['POST /api/auth/login', 'POST /api/nodes/:id/apply'].includes(row[0]))
  const filtered = (errors ? flagged : http).filter((row) => matches(row, search))
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <Choice label="Период" options={periods} value={period} change={setPeriod} />
        <Chip label="Только с ошибками" count={flagged.length} active={errors} onClick={() => setErrors(!errors)} />
        <Search hint="Маршрут" value={search} change={setSearch} />
      </div>
      <div className={styles.metrics}>
        {[
          [number(182340 * scale), 'запросов за ' + period],
          ['2.1', 'запроса в секунду'],
          ['84 мс', '95% ответов быстрее'],
          [number(41 * scale), 'ответ 5xx'],
        ].map(([value, label]) => (
          <div key={label} className={styles.metric}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className={styles.card + ' ' + styles.plotBox}>
        <div className={styles.toolbar}>
          <h2>Запросы по часам, UTC</h2>
          <span className={styles.push} />
          <span className={styles.legend}>все</span>
          <span className={styles.legend + ' ' + styles.errorLegend}>ответы 5xx</span>
        </div>
        <svg
          className={styles.plot}
          viewBox="0 0 1048 96"
          preserveAspectRatio="none"
          role="img"
          aria-label="Все запросы и ответы 5xx по часам UTC"
        >
          {hours.map((total, hour) => {
            const x = Math.round(((hour + 0.5) * 1048) / hours.length) - 8
            const failed = errorsByHour[hour] ?? 0
            return (
              <g key={hour}>
                <title>
                  {hour}:00 UTC · {number(total * scale)} · 5xx: {number(failed * scale)}
                </title>
                <rect className={styles.plotTotal} x={x} y={96 - total} width="16" height={total} />
                {failed > 0 && <rect className={styles.plotErrors} x={x} y={96 - failed} width="16" height={failed} />}
              </g>
            )
          })}
        </svg>
        <div className={styles.ticks} aria-hidden="true">
          {['00', '06', '12', '18', '23'].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
      </section>
      <Table
        columns={['Маршрут', 'Запросов', '2xx', '4xx', '5xx', 'p50', 'p95']}
        rows={filtered.map(([route, ...stats]) => ({
          id: route,
          cells: [route, ...stats.map((cell, i) => (i < 4 ? number(count(cell) * scale) : cell))],
        }))}
      />
    </div>
  )
}
