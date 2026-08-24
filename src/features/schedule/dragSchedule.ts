import type { ScheduleBlock } from '../../domain/tasks'

export interface GridScale {
  dayStartMinutes: number
  hourHeight: number
  snapMinutes: number
}

export interface ScheduleUndoState {
  blockId: string
  taskId: string
  startsAt: string
  endsAt: string
  version: number
}

export interface ScheduleBlockChange {
  block: ScheduleBlock
  undo: ScheduleUndoState
}

const MINIMUM_BLOCK_MINUTES = 15

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function scheduleDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('日程时间无效')
  return dateKey(date)
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('日期必须使用 YYYY-MM-DD')
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (dateKey(date) !== value) throw new Error('日期无效')
  return date
}

function snap(value: number, step: number) {
  return Math.round(value / step) * step
}

function undoState(block: ScheduleBlock): ScheduleUndoState {
  return {
    blockId: block.id,
    taskId: block.taskId,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    version: block.version,
  }
}

function shiftedInstant(value: string, minutes: number) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new Error('日程时间无效')
  return new Date(timestamp + minutes * 60_000).toISOString()
}

function sameDate(left: string, right: string) {
  return scheduleDateKey(left) === scheduleDateKey(right)
}

function assertSingleDate(original: ScheduleBlock, startsAt: string, endsAt: string) {
  if (!sameDate(original.startsAt, original.endsAt)
    || !sameDate(original.startsAt, startsAt)
    || !sameDate(startsAt, endsAt)) {
    throw new Error('日程块不能跨日，请拆成两个安排')
  }
}

export function minutesToGridPosition(minutes: number, scale: GridScale) {
  return ((minutes - scale.dayStartMinutes) / 60) * scale.hourHeight
}

export function gridPositionToMinutes(position: number, scale: GridScale) {
  const rawMinutes = scale.dayStartMinutes + (position / scale.hourHeight) * 60
  return snap(rawMinutes, scale.snapMinutes)
}

export function localWeekDates(value: string) {
  const date = parseDateKey(value)
  const mondayOffset = (date.getDay() + 6) % 7
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)
    return dateKey(day)
  })
}

export function moveScheduleBlock(block: ScheduleBlock, deltaMinutes: number): ScheduleBlockChange {
  const delta = snap(deltaMinutes, MINIMUM_BLOCK_MINUTES)
  const startsAt = shiftedInstant(block.startsAt, delta)
  const endsAt = shiftedInstant(block.endsAt, delta)
  assertSingleDate(block, startsAt, endsAt)
  return { block: { ...block, startsAt, endsAt }, undo: undoState(block) }
}

export function resizeScheduleBlock(block: ScheduleBlock, edge: 'start' | 'end', deltaMinutes: number): ScheduleBlockChange {
  const delta = snap(deltaMinutes, MINIMUM_BLOCK_MINUTES)
  const startTime = Date.parse(block.startsAt)
  const endTime = Date.parse(block.endsAt)
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) throw new Error('日程时间无效')

  let startsAt = block.startsAt
  let endsAt = block.endsAt
  if (edge === 'start') {
    const candidate = Math.min(startTime + delta * 60_000, endTime - MINIMUM_BLOCK_MINUTES * 60_000)
    startsAt = new Date(candidate).toISOString()
  } else {
    const candidate = Math.max(endTime + delta * 60_000, startTime + MINIMUM_BLOCK_MINUTES * 60_000)
    endsAt = new Date(candidate).toISOString()
  }
  assertSingleDate(block, startsAt, endsAt)
  return { block: { ...block, startsAt, endsAt }, undo: undoState(block) }
}
