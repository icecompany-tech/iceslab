import { Fragment, type ReactNode } from 'react'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Dialog } from '@/ui/Dialog/Dialog'
import { Input } from '@/ui/Field/Field'
import { QueryFailed } from '@/ui/QueryState/QueryState'
import { Segmented } from '@/ui/Segmented/Segmented'
import styles from './review.module.css'

export function Failure({ title, reset }: { title: string; reset: () => void }) {
  return (
    <QueryFailed
      title={title}
      body="Повторите запрос, чтобы загрузить данные."
      retryLabel="Повторить"
      onRetry={reset}
    />
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className={styles.empty}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function Tabs({
  labels,
  counts,
  value,
  change,
}: {
  labels: string[]
  counts?: number[]
  value: string
  change: (value: string) => void
}) {
  return (
    <>
      {labels.map((label, i) => (
        <Chip key={label} label={label} count={counts?.[i]} active={label === value} onClick={() => change(label)} />
      ))}
    </>
  )
}

export function Choice({
  label,
  options,
  value,
  change,
}: {
  label: string
  options: string[]
  value: string
  change: (value: string) => void
}) {
  return (
    <Segmented
      label={label}
      options={options.map((option) => ({ value: option, label: option }))}
      value={value}
      onChange={change}
    />
  )
}

export function Search({ hint, value, change }: { hint: string; value: string; change: (value: string) => void }) {
  return (
    <div className={styles.search}>
      <Input
        fieldSize="sm"
        type="search"
        aria-label={hint}
        placeholder={hint}
        value={value}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  )
}

export interface ReviewRow {
  id: string
  cells: ReactNode[]
  detail?: ReactNode
}

export function Table({
  columns,
  rows,
  note,
  foot,
}: {
  columns: string[]
  rows: ReviewRow[]
  note?: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className={styles.registry}>
      {note && <p className={styles.note}>{note}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, cells, detail }) => (
            <Fragment key={id}>
              <tr>
                {cells.map((cell, i) => (
                  <td key={columns[i]}>{cell}</td>
                ))}
              </tr>
              {detail && (
                <tr>
                  <td colSpan={columns.length}>{detail}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className={styles.note}>Ничего не найдено</p>}
      {foot && <p className={styles.note}>{foot}</p>}
    </div>
  )
}

export function Question({
  title,
  children,
  cancel = 'Отмена',
  accept,
  onClose,
  onAccept,
}: {
  title: string
  children: ReactNode
  cancel?: string
  accept: string
  onClose: () => void
  onAccept: () => void
}) {
  return (
    <Dialog
      title={title}
      closeLabel={cancel}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{cancel}</Button>
          <Button variant="danger" onClick={onAccept}>
            {accept}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
