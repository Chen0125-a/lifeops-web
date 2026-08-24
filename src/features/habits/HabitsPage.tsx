import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CreateHabitEntryInput, CreateHabitInput, Habit, UpdateHabitInput } from '../../domain/habits'
import { HabitEditor } from './HabitEditor'
import { HabitInspector } from './HabitInspector'
import { HabitMatrix, type HabitCellSelection, isHabitExpected } from './HabitMatrix'
import { useHabits } from './useHabits'

interface HabitsPageProps {
  now?: Date
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function matrixDates(today: string) {
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay() || 7
  const start = shiftDate(today, -(weekday - 1) - 21)
  return Array.from({ length: 28 }, (_, index) => shiftDate(start, index))
}

function statusMessage(status: ReturnType<typeof useHabits>['status']) {
  if (status === 'forbidden') return '你没有访问这些习惯的权限。'
  if (status === 'conflict') return '习惯已在其他位置更新，请刷新后继续。'
  if (status === 'disconnected') return '当前离线，记录没有被伪装成已保存。'
  return '习惯数据暂时无法读取。'
}

export function HabitsPage({ now = new Date() }: HabitsPageProps) {
  const today = dateKey(now)
  const dates = useMemo(() => matrixDates(today), [today])
  const habitsState = useHabits({ from: dates[0], to: dates.at(-1) ?? today })
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedDate, setSelectedDate] = useState(today)
  const [showFullMobile, setShowFullMobile] = useState(false)
  const [editorHabit, setEditorHabit] = useState<Habit | null | undefined>(undefined)
  const activeHabits = habitsState.habits.filter((habit) => habit.status !== 'archived')
  const selectedId = searchParams.get('habit')
  const selectedHabit = activeHabits.find((habit) => habit.id === selectedId) ?? activeHabits[0]
  const todayHabits = activeHabits.filter((habit) => isHabitExpected(habit, today))

  const selectHabit = (habitId: string, date = selectedDate) => {
    const next = new URLSearchParams(searchParams)
    next.set('habit', habitId)
    setSearchParams(next, { replace: selectedId == null })
    setSelectedDate(date)
  }

  const handleCell = async (selection: HabitCellSelection) => {
    selectHabit(selection.habitId, selection.date)
    const habit = activeHabits.find((item) => item.id === selection.habitId)
    if (habit?.measure === 'boolean' && selection.date === today && selection.state === 'missed') {
      try {
        await habitsState.upsertEntry(habit.id, today, { status: 'done', value: 1, note: '' })
      } catch {
        // The hook keeps the failure visible beside the unchanged rhythm matrix.
      }
    }
  }

  const saveEditor = async (input: CreateHabitInput | UpdateHabitInput) => {
    if (editorHabit) await habitsState.updateHabit(editorHabit.id, input as UpdateHabitInput)
    else {
      const created = await habitsState.createHabit(input as CreateHabitInput)
      selectHabit(created.id, today)
    }
  }

  const saveEntry = (input: CreateHabitEntryInput) => {
    if (!selectedHabit) return Promise.resolve()
    return habitsState.upsertEntry(selectedHabit.id, selectedDate, input).then(() => undefined)
  }

  return (
    <article className="habits-page">
      <header className="habits-page__hero">
        <div><p className="private-route-kicker">节奏不是奖惩</p><h1 tabIndex={-1}>习惯</h1><p>记录实际完成、部分完成与主动调整，让趋势服务判断，而不是制造压力。</p></div>
        <button type="button" className="habits-page__create" onClick={() => setEditorHabit(null)}>新建习惯</button>
      </header>

      {habitsState.status === 'loading' ? <section className="habits-state" aria-live="polite"><span />正在读取节奏事实…</section> : null}
      {['network-error', 'forbidden', 'conflict', 'disconnected'].includes(habitsState.status) ? (
        <section className="habits-state is-error" role="alert"><h2>这一部分暂时不可用</h2><p>{statusMessage(habitsState.status)}</p><button type="button" onClick={habitsState.retry}>重试</button></section>
      ) : null}
      {habitsState.status === 'empty' ? (
        <section className="habits-state"><h2>还没有习惯</h2><p>从一个可以被诚实记录的小节奏开始。</p><button type="button" onClick={() => setEditorHabit(null)}>创建第一个习惯</button></section>
      ) : null}

      {habitsState.status === 'ready' && habitsState.error ? (
        <section className="habits-page__mutation-error" role="alert">
          <p>{statusMessage(habitsState.error.status === 409 ? 'conflict' : habitsState.error.status === 403 ? 'forbidden' : 'network-error')}</p>
          <button type="button" onClick={habitsState.retry}>重试</button>
        </section>
      ) : null}

      {habitsState.status === 'ready' ? (
        <>
          <section className="habits-today" aria-label="今天的习惯">
            <header><div><span>{today}</span><h2>今天的习惯</h2></div><p>{todayHabits.length} 个计划节奏</p></header>
            <div className="habits-today__list">
              {todayHabits.map((habit) => {
                const entry = habitsState.entries.find((item) => item.habitId === habit.id && item.entryDate === today)
                return (
                  <button type="button" key={habit.id} data-selected={habit.id === selectedHabit?.id} onClick={() => selectHabit(habit.id, today)}>
                    <span>{habit.title}</span><strong>{entry ? entry.status === 'done' ? '已完成' : entry.status === 'partial' ? '部分完成' : '有意跳过' : '等待记录'}</strong>
                    <small>{habit.targetValue ?? '—'}{habit.unit ?? ''}</small>
                  </button>
                )
              })}
            </div>
          </section>

          <div className="habits-page__workspace">
            <section className="habits-rhythm" aria-label="习惯节奏矩阵">
              <header><div><span>四周视野</span><h2>28 日节奏</h2></div><button type="button" className="habits-rhythm__mobile-toggle" aria-expanded={showFullMobile} onClick={() => setShowFullMobile((value) => !value)}>{showFullMobile ? '只看最近 7 日' : '查看完整 28 日'}</button></header>
              <HabitMatrix habits={activeHabits} entries={habitsState.entries} dates={dates} today={today} selectedHabitId={selectedHabit?.id ?? null} selectedDate={selectedDate} showFullMobile={showFullMobile} onSelect={(selection) => void handleCell(selection)} />
            </section>
            <HabitInspector
              habit={selectedHabit}
              entries={habitsState.entries}
              dates={dates}
              today={today}
              selectedDate={selectedDate}
              saving={habitsState.isSaving}
              onEdit={() => setEditorHabit(selectedHabit)}
              onPause={() => selectedHabit ? habitsState.pauseHabit(selectedHabit.id, selectedHabit.version).then(() => undefined) : Promise.resolve()}
              onArchive={() => selectedHabit ? habitsState.archiveHabit(selectedHabit.id, selectedHabit.version).then(() => undefined) : Promise.resolve()}
              onEntry={saveEntry}
            />
          </div>
        </>
      ) : null}

      {editorHabit !== undefined ? <HabitEditor habit={editorHabit ?? undefined} onClose={() => setEditorHabit(undefined)} onSave={saveEditor} /> : null}
    </article>
  )
}
