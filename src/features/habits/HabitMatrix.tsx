import type { CSSProperties } from 'react'
import type { Habit, HabitEntry } from '../../domain/habits'

export type HabitCellState = 'not-expected' | 'future' | 'done' | 'partial' | 'intentional-skip' | 'missed'

export interface HabitCellSelection {
  habitId: string
  date: string
  state: HabitCellState
}

interface HabitMatrixProps {
  habits: Habit[]
  entries: HabitEntry[]
  dates: string[]
  today: string
  selectedHabitId: string | null
  selectedDate: string
  showFullMobile: boolean
  onSelect(selection: HabitCellSelection): void
}

function dayNumber(value: string) {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000)
}

function isoWeekday(value: string) {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function isHabitExpected(habit: Habit, date: string) {
  if (date < habit.schedule.startsOn) return false
  if (habit.schedule.endsOn && date > habit.schedule.endsOn) return false
  if (habit.status === 'archived') return false
  if (habit.status === 'paused' && habit.pausedAt && date >= habit.pausedAt.slice(0, 10)) return false
  if (habit.schedule.scheduleType === 'daily' || habit.schedule.scheduleType === 'times-per-week') return true
  if (habit.schedule.scheduleType === 'weekdays') return Boolean(habit.schedule.weekdays?.includes(isoWeekday(date)))
  return (dayNumber(date) - dayNumber(habit.schedule.startsOn)) % (habit.schedule.intervalDays ?? 1) === 0
}

export function habitCellState(habit: Habit, entry: HabitEntry | undefined, date: string, today: string): HabitCellState {
  if (!isHabitExpected(habit, date)) return 'not-expected'
  if (date > today) return 'future'
  if (entry?.status === 'done') return 'done'
  if (entry?.status === 'partial') return 'partial'
  if (entry?.status === 'intentional-skip') return 'intentional-skip'
  return 'missed'
}

function shortDate(value: string) {
  const [, month, day] = value.split('-').map(Number)
  return `${month}月${day}日`
}

function progressText(habit: Habit, entry: HabitEntry) {
  if (habit.measure === 'boolean') return ''
  const value = entry.value ?? 0
  const target = habit.targetValue ?? 0
  const unit = habit.unit ? ` ${habit.unit}` : ''
  return ` ${value}/${target}${unit}`
}

export function habitCellLabel(habit: Habit, entry: HabitEntry | undefined, date: string, state: HabitCellState) {
  const prefix = `${habit.title}，${shortDate(date)}，`
  if (state === 'not-expected') return `${prefix}非计划日`
  if (state === 'future') return `${prefix}未来`
  if (state === 'missed') return `${prefix}未完成`
  if (state === 'intentional-skip') return `${prefix}有意跳过${entry?.note ? `：${entry.note}` : ''}`
  if (!entry) return `${prefix}未完成`
  return `${prefix}${state === 'done' ? '已完成' : '部分完成'}${progressText(habit, entry)}`
}

export function HabitMatrix({
  habits,
  entries,
  dates,
  today,
  selectedHabitId,
  selectedDate,
  showFullMobile,
  onSelect,
}: HabitMatrixProps) {
  const entriesByKey = new Map(entries.map((entry) => [`${entry.habitId}:${entry.entryDate}`, entry]))
  return (
    <div className="habit-matrix-scroll" data-full-mobile={showFullMobile}>
      <div
        className="habit-matrix"
        role="grid"
        aria-label="28 日习惯节奏"
        data-days={dates.length}
        style={{ '--habit-days': dates.length } as CSSProperties}
      >
        <div className="habit-matrix__header" role="row">
          <div className="habit-matrix__corner" aria-hidden="true">节奏 / 日期</div>
          {dates.map((date, index) => (
            <div
              className="habit-matrix__date"
              role="columnheader"
              key={date}
              data-today={date === today}
              data-mobile-visible={index >= dates.length - 7}
            >
              <span>{shortDate(date).replace('月', '/').replace('日', '')}</span>
              <small>{['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00.000Z`).getUTCDay()]}</small>
            </div>
          ))}
        </div>
        {habits.map((habit) => (
          <div className="habit-matrix__row" role="row" key={habit.id} data-selected={habit.id === selectedHabitId}>
            <div className="habit-matrix__habit" role="rowheader">
              <strong>{habit.title}</strong>
              <span>{habit.targetValue ?? '—'}{habit.unit ?? ''}</span>
            </div>
            {dates.map((date, index) => {
              const entry = entriesByKey.get(`${habit.id}:${date}`)
              const state = habitCellState(habit, entry, date, today)
              return (
                <div className="habit-matrix__cell" role="gridcell" key={date} data-mobile-visible={index >= dates.length - 7}>
                  <button
                    type="button"
                    aria-label={habitCellLabel(habit, entry, date, state)}
                    aria-pressed={habit.id === selectedHabitId && date === selectedDate}
                    data-state={state}
                    onClick={() => onSelect({ habitId: habit.id, date, state })}
                  >
                    <span aria-hidden="true">{state === 'done' ? '✓' : state === 'partial' ? '◒' : state === 'intentional-skip' ? '—' : state === 'missed' ? '·' : ''}</span>
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
