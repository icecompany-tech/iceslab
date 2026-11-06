import { parseAbsolute, type ZonedDateTime } from '@internationalized/date'
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
  Popover,
  Text,
} from 'react-aria-components'
import styles from '@/ui/DateTimeField/DateTimeField.module.css'
import { Icon } from '@/ui/Icon/Icon'

export interface DateTimeFieldTexts {
  open: string
  previousMonth: string
  nextMonth: string
}

export interface DateTimeFieldProps {
  label: string
  /** An instant as the server sends it, ISO 8601 with an offset; null is "no date". */
  value: string | null
  onChange: (next: string | null) => void
  /** Whose wall clock the field shows, IANA name. From the caller: no global clock here. */
  timeZone: string
  error?: string
  texts: DateTimeFieldTexts
}

export function DateTimeField({ label, value, onChange, timeZone, error, texts }: DateTimeFieldProps) {
  return (
    <DatePicker<ZonedDateTime>
      className={styles.picker}
      granularity="minute"
      hourCycle={24}
      hideTimeZone
      shouldForceLeadingZeros
      isInvalid={error !== undefined}
      value={value === null ? null : parseAbsolute(value, timeZone)}
      onChange={(next) => onChange(next === null ? null : next.toAbsoluteString())}
    >
      <Label className={styles.label}>{label}</Label>
      <Group className={styles.field}>
        <DateInput className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <Button aria-label={texts.open} className={styles.open}>
          <Icon name="calendar" />
        </Button>
      </Group>
      {error !== undefined && (
        <Text slot="errorMessage" className={styles.error}>
          {error}
        </Text>
      )}
      <Popover className={styles.popover} placement="bottom end" offset={6}>
        <Dialog className={styles.dialog}>
          <Calendar>
            <header className={styles.month}>
              <Button slot="previous" aria-label={texts.previousMonth} className={styles.step}>
                <Icon name="chevronLeft" size="md" />
              </Button>
              <Heading className={styles.heading} />
              <Button slot="next" aria-label={texts.nextMonth} className={styles.step}>
                <Icon name="chevronRight" size="md" />
              </Button>
            </header>
            <CalendarGrid className={styles.grid} weekdayStyle="short">
              <CalendarGridHeader>
                {(day) => <CalendarHeaderCell className={styles.weekday}>{day}</CalendarHeaderCell>}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => <CalendarCell date={date} className={styles.day} />}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </DatePicker>
  )
}
