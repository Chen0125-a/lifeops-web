import type { Goal, Project } from '../../domain/goals'
import type { Habit, HabitEntry, HabitEntryStatus } from '../../domain/habits'
import type { LifeRecord } from '../../domain/records'
import type { Review } from '../../domain/reviews'
import type { Task, TaskStatus } from '../../domain/tasks'
import type { KnowledgeNote } from '../../domain/types'

export type PlatformHealth = 'healthy' | 'degraded' | 'disconnected' | 'unknown'
export interface OverviewKnowledge extends KnowledgeNote { reviewOn?: string | null; updatedAt?: string }
export interface OverviewModelInput {
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
  habits: Habit[]
  entries: HabitEntry[]
  records: LifeRecord[]
  reviews: Review[]
  knowledge: OverviewKnowledge[]
  now: Date
  platformHealth?: PlatformHealth
}
export interface OverviewModel {
  isEmpty: boolean
  statusStrip: { dateLabel: string; greeting: string; week: { completed: number; total: number }; platformHealth: PlatformHealth }
  todayTimeline: Array<{ id: string; title: string; at: string | null; status: TaskStatus }>
  topGoals: Array<{ id: string; title: string; priority: Goal['priority']; progress: number }>
  activeProjects: Array<{ id: string; title: string; goalId: string | null; progress: number }>
  habitWeek: {
    days: Array<{ date: string; label: string }>
    rows: Array<{ id: string; title: string; cells: Array<{ date: string; status: HabitEntryStatus | 'pending' | 'not-scheduled' }> }>
    totals: { done: number; partial: number; intentionalSkip: number; missed: number; pending: number }
  }
  trends: { completedTasks: number; habitCompletions: number; recordCount: number }
  recentRecords: LifeRecord[]
  priorInsight: { reviewId: string; text: string } | null
  resurfacedKnowledge: OverviewKnowledge[]
}

function dateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function startOfWeek(now: Date) {
  const result = new Date(now)
  result.setHours(0, 0, 0, 0)
  const weekday = result.getDay()
  result.setDate(result.getDate() - (weekday === 0 ? 6 : weekday - 1))
  return result
}

function weekDays(now: Date) {
  const monday = startOfWeek(now)
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(monday)
    value.setDate(monday.getDate() + index)
    return { value, date: dateKey(value), label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(value) }
  })
}

function scheduledOn(habit: Habit, date: Date) {
  const key = dateKey(date)
  if (key < habit.schedule.startsOn || (habit.schedule.endsOn && key > habit.schedule.endsOn)) return false
  if (habit.schedule.scheduleType === 'weekdays') return habit.schedule.weekdays?.includes(date.getDay()) ?? false
  if (habit.schedule.scheduleType === 'interval') {
    const start = new Date(`${habit.schedule.startsOn}T00:00:00`)
    const elapsed = Math.floor((date.getTime() - start.getTime()) / 86_400_000)
    return elapsed >= 0 && elapsed % (habit.schedule.intervalDays ?? 1) === 0
  }
  return true
}

function taskMoment(task: Task) {
  return parseDate(task.startsAt ?? task.dueAt)
}

export function buildOverviewModel(input: OverviewModelInput): OverviewModel {
  const days = weekDays(input.now)
  const weekStart = days[0]?.date ?? dateKey(input.now)
  const weekEnd = days.at(-1)?.date ?? weekStart
  const today = dateKey(input.now)
  const visibleTasks = input.tasks.filter((task) => !task.deletedAt && task.status !== 'cancelled')
  const weekTasks = visibleTasks.filter((task) => {
    const moment = taskMoment(task)
    if (!moment) return false
    const key = dateKey(moment)
    return key >= weekStart && key <= weekEnd
  })
  const todayTimeline = visibleTasks
    .filter((task) => {
      const moment = taskMoment(task)
      return moment ? dateKey(moment) === today : false
    })
    .sort((left, right) => (taskMoment(left)?.getTime() ?? 0) - (taskMoment(right)?.getTime() ?? 0))
    .map((task) => ({
      id: task.id,
      title: task.title,
      at: taskMoment(task)?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) ?? null,
      status: task.status,
    }))
  const topGoals = input.goals
    .filter((goal) => goal.status === 'active' && !goal.deletedAt)
    .sort((left, right) => left.priority - right.priority
      || (left.targetOn ?? '9999-12-31').localeCompare(right.targetOn ?? '9999-12-31')
      || left.title.localeCompare(right.title, 'zh-CN'))
    .slice(0, 3)
    .map((goal) => ({ id: goal.id, title: goal.title, priority: goal.priority, progress: goal.manualProgress }))
  const activeProjects = input.projects
    .filter((project) => project.status === 'active' && !project.deletedAt)
    .sort((left, right) => (left.targetOn ?? '9999-12-31').localeCompare(right.targetOn ?? '9999-12-31')
      || left.title.localeCompare(right.title, 'zh-CN'))
    .map((project) => ({ id: project.id, title: project.title, goalId: project.goalId, progress: project.progress }))
  const currentEntries = input.entries.filter((entry) => !entry.deletedAt && entry.entryDate >= weekStart && entry.entryDate <= weekEnd)
  const rows = input.habits
    .filter((habit) => habit.status === 'active' && !habit.deletedAt)
    .map((habit) => ({
      id: habit.id,
      title: habit.title,
      cells: days.map(({ value, date }) => {
        const status: OverviewModel['habitWeek']['rows'][number]['cells'][number]['status'] =
          currentEntries.find((entry) => entry.habitId === habit.id && entry.entryDate === date)?.status
            ?? (scheduledOn(habit, value) ? 'pending' : 'not-scheduled')
        return { date, status }
      }),
    }))
  const statuses = rows.flatMap((row) => row.cells.map((cell) => cell.status))
  const habitTotals = {
    done: statuses.filter((status) => status === 'done').length,
    partial: statuses.filter((status) => status === 'partial').length,
    intentionalSkip: statuses.filter((status) => status === 'intentional-skip').length,
    missed: statuses.filter((status) => status === 'missed').length,
    pending: statuses.filter((status) => status === 'pending').length,
  }
  const recentRecords = input.records
    .filter((record) => !record.deletedAt && !record.archivedAt)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 3)
  const latestReview = input.reviews
    .filter((review) => !review.deletedAt && review.insights.some((insight) => insight.trim()))
    .sort((left, right) => right.period.to.localeCompare(left.period.to) || right.updatedAt.localeCompare(left.updatedAt))[0]
  const resurfacedKnowledge = input.knowledge
    .filter((note) => note.reviewOn && note.reviewOn <= today)
    .sort((left, right) => (left.reviewOn ?? '').localeCompare(right.reviewOn ?? '')
      || (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt))
    .slice(0, 3)
  const hour = input.now.getHours()
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const weekRecords = input.records.filter((record) => {
    const key = dateKey(new Date(record.occurredAt))
    return !record.deletedAt && key >= weekStart && key <= weekEnd
  })

  return {
    isEmpty: todayTimeline.length === 0 && topGoals.length === 0 && rows.length === 0
      && recentRecords.length === 0 && !latestReview && resurfacedKnowledge.length === 0,
    statusStrip: {
      dateLabel: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(input.now),
      greeting,
      week: { completed: weekTasks.filter((task) => task.status === 'done').length, total: weekTasks.length },
      platformHealth: input.platformHealth ?? 'unknown',
    },
    todayTimeline,
    topGoals,
    activeProjects,
    habitWeek: { days: days.map(({ date, label }) => ({ date, label })), rows, totals: habitTotals },
    trends: {
      completedTasks: weekTasks.filter((task) => task.status === 'done').length,
      habitCompletions: currentEntries.filter((entry) => entry.status === 'done').length,
      recordCount: weekRecords.length,
    },
    recentRecords,
    priorInsight: latestReview ? { reviewId: latestReview.id, text: latestReview.insights.find((insight) => insight.trim())! } : null,
    resurfacedKnowledge,
  }
}
