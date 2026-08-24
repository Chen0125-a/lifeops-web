import { useEffect, useMemo, useState } from 'react'
import type { CreateHabitEntryInput, Habit, HabitEntry } from '../../domain/habits'
import { isHabitExpected } from './HabitMatrix'

interface HabitInspectorProps {
  habit?: Habit
  entries: HabitEntry[]
  dates: string[]
  today: string
  selectedDate: string
  saving: boolean
  onEdit(): void
  onPause(): Promise<void>
  onArchive(): Promise<void>
  onEntry(input: CreateHabitEntryInput): Promise<void>
}

function entryValue(habit: Habit, entry: HabitEntry | undefined) {
  if (entry?.value != null) return String(entry.value)
  return habit.measure === 'boolean' ? '1' : String(habit.targetValue ?? '')
}

export function HabitInspector({ habit, entries, dates, today, selectedDate, saving, onEdit, onPause, onArchive, onEntry }: HabitInspectorProps) {
  const selectedEntry = habit ? entries.find((entry) => entry.habitId === habit.id && entry.entryDate === selectedDate) : undefined
  const [value, setValue] = useState('')
  const [skipOpen, setSkipOpen] = useState(false)
  const [skipReason, setSkipReason] = useState('')

  useEffect(() => {
    setValue(habit ? entryValue(habit, selectedEntry) : '')
    setSkipOpen(false)
    setSkipReason(selectedEntry?.status === 'intentional-skip' ? selectedEntry.note : '')
  }, [habit, selectedEntry, selectedDate])

  const statistics = useMemo(() => {
    if (!habit) return { expected: 0, done: 0, partialValue: 0, skips: 0, trend: '没有足够数据' }
    const relevantDates = dates.filter((date) => date <= today && isHabitExpected(habit, date))
    const habitEntries = entries.filter((entry) => entry.habitId === habit.id)
    const done = habitEntries.filter((entry) => entry.status === 'done' && relevantDates.includes(entry.entryDate)).length
    const partialValue = habitEntries
      .filter((entry) => entry.status === 'partial' && relevantDates.includes(entry.entryDate))
      .reduce((sum, entry) => sum + (entry.value ?? 0), 0)
    const skips = habitEntries.filter((entry) => entry.status === 'intentional-skip' && relevantDates.includes(entry.entryDate)).length
    const recent = relevantDates.slice(-7)
    const prior = relevantDates.slice(-14, -7)
    const score = (range: string[]) => habitEntries
      .filter((entry) => range.includes(entry.entryDate) && (entry.status === 'done' || entry.status === 'partial'))
      .reduce((sum, entry) => sum + (entry.value ?? (entry.status === 'done' ? 1 : 0)), 0)
    const recentScore = score(recent)
    const priorScore = score(prior)
    const trend = recentScore === priorScore ? '与前 7 日持平' : recentScore > priorScore ? '较前 7 日上升' : '较前 7 日下降'
    return { expected: relevantDates.length, done, partialValue, skips, trend }
  }, [dates, entries, habit, today])

  if (!habit) {
    return <aside className="habit-inspector" role="region" aria-label="习惯检查器"><h2>选择一个习惯</h2><p>从今日清单或节奏矩阵选择后，在这里记录和复核。</p></aside>
  }

  const numericValue = Number(value)
  const usableValue = Number.isFinite(numericValue) ? numericValue : null
  const submit = (status: CreateHabitEntryInput['status']) => onEntry({
    status,
    value: habit.measure === 'boolean' ? 1 : usableValue,
    note: '',
  })

  return (
    <aside className="habit-inspector" role="region" aria-label="习惯检查器">
      <header>
        <span>当前节奏</span>
        <h2>{habit.title}</h2>
        <p>{habit.description || '用真实记录观察节奏，不以连续天数施压。'}</p>
      </header>

      <dl className="habit-inspector__stats">
        <div><dt>完成应做天数</dt><dd>{statistics.done}/{statistics.expected}</dd></div>
        <div><dt>部分完成总量</dt><dd>{statistics.partialValue}{habit.unit ? ` ${habit.unit}` : ''}</dd></div>
        <div><dt>有意跳过</dt><dd>{statistics.skips} 天</dd></div>
        <div><dt>最近 7 日趋势</dt><dd>{statistics.trend}</dd></div>
      </dl>

      <div className="habit-inspector__links" aria-label="关联对象">
        <span>目标 {habit.goalId ?? '未关联'}</span>
        <span>项目 {habit.projectId ?? '未关联'}</span>
      </div>

      <section className="habit-inspector__entry" aria-label={`${selectedDate} 记录`}>
        <div className="habit-inspector__entry-heading"><span>记录日期</span><strong>{selectedDate}</strong></div>
        {habit.measure !== 'boolean' ? (
          <label className="habit-value-field">
            <span>记录值</span>
            <span><input aria-label="记录值" type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} /><b>{habit.unit ?? '单位'}</b></span>
          </label>
        ) : null}
        <div className="habit-inspector__entry-actions">
          <button type="button" className="is-primary" disabled={saving} onClick={() => void submit('done').catch(() => undefined)}>完成并保存</button>
          <button type="button" disabled={saving} onClick={() => void submit('partial').catch(() => undefined)}>部分完成</button>
          <button type="button" disabled={saving} onClick={() => setSkipOpen(true)}>有意跳过</button>
        </div>
        {skipOpen ? (
          <div className="habit-inspector__skip">
            <label><span>跳过原因</span><textarea aria-label="跳过原因" value={skipReason} onChange={(event) => setSkipReason(event.target.value)} /></label>
            <button type="button" disabled={saving || !skipReason.trim()} onClick={() => void onEntry({ status: 'intentional-skip', value: null, note: skipReason.trim() }).catch(() => undefined)}>确认有意跳过</button>
          </div>
        ) : null}
      </section>

      <div className="habit-inspector__actions">
        <button type="button" onClick={onEdit}>编辑习惯</button>
        <button type="button" disabled={saving || habit.status === 'paused'} onClick={() => void onPause().catch(() => undefined)}>暂停习惯</button>
        <button type="button" className="is-danger" disabled={saving || habit.status === 'archived'} onClick={() => void onArchive().catch(() => undefined)}>归档习惯</button>
      </div>
    </aside>
  )
}
