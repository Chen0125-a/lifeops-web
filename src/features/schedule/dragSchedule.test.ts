import { describe, expect, it } from 'vitest'
import type { ScheduleBlock } from '../../domain/tasks'
import {
  gridPositionToMinutes,
  localWeekDates,
  minutesToGridPosition,
  moveScheduleBlock,
  resizeScheduleBlock,
  scheduleDateKey,
} from './dragSchedule'

const block: ScheduleBlock = {
  id: 'block-1',
  taskId: 'task-1',
  startsAt: '2026-08-12T09:00:00.000Z',
  endsAt: '2026-08-12T10:00:00.000Z',
  version: 4,
}

describe('schedule coordinate model', () => {
  it('maps grid coordinates with exact 15-minute snapping', () => {
    const scale = { dayStartMinutes: 480, hourHeight: 64, snapMinutes: 15 }

    expect(minutesToGridPosition(570, scale)).toBe(96)
    expect(gridPositionToMinutes(103, scale)).toBe(570)
    expect(gridPositionToMinutes(112, scale)).toBe(585)
  })

  it('derives a Monday-first timezone-local week without UTC date drift', () => {
    expect(localWeekDates('2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ])

    const localHalfPastMidnight = new Date(2026, 7, 16, 0, 30).toISOString()
    expect(scheduleDateKey(localHalfPastMidnight)).toBe('2026-08-16')
  })

  it('moves on the snapped grid and retains one exact undo state', () => {
    const result = moveScheduleBlock(block, 23)

    expect(result.block).toMatchObject({
      startsAt: '2026-08-12T09:30:00.000Z',
      endsAt: '2026-08-12T10:30:00.000Z',
      version: 4,
    })
    expect(result.undo).toEqual({
      blockId: 'block-1',
      taskId: 'task-1',
      startsAt: '2026-08-12T09:00:00.000Z',
      endsAt: '2026-08-12T10:00:00.000Z',
      version: 4,
    })
  })

  it('keeps a resized block at least 15 minutes long', () => {
    expect(resizeScheduleBlock(block, 'end', -55).block.endsAt)
      .toBe('2026-08-12T09:15:00.000Z')
    expect(resizeScheduleBlock(block, 'start', 55).block.startsAt)
      .toBe('2026-08-12T09:45:00.000Z')
  })

  it('rejects moving or resizing a block across a local date boundary', () => {
    const late = {
      ...block,
      startsAt: new Date(2026, 7, 12, 23, 30).toISOString(),
      endsAt: new Date(2026, 7, 12, 23, 45).toISOString(),
    }

    expect(() => moveScheduleBlock(late, 30)).toThrow(/跨日/)
    expect(() => resizeScheduleBlock(late, 'end', 30)).toThrow(/跨日/)
  })
})
