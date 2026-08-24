import { describe, expect, it } from 'vitest'
import type { Goal } from '../../domain/goals.js'
import { GoalsMemoryStore } from './goalsMemoryStore.js'

interface RecoveryEvent {
  id: string
  action: 'goal.archive' | 'goal.restore'
  entityType: 'goal'
  entityId: string
  details: {
    versionBefore: number
    versionAfter: number
    reversesEventId: string | null
  }
}

type GoalRecoveryMemoryStore = GoalsMemoryStore & {
  restoreGoal(userId: string, id: string, version: number): Promise<Goal | undefined>
  listGoalRecoveryAuditEvents(userId: string, entityType: 'goal', entityId: string): Promise<RecoveryEvent[]>
}

describe('GoalsMemoryStore recovery transactions', () => {
  it('keeps an archive intact when restore audit creation fails, then links the successful reversal', async () => {
    let sequence = 0
    let failRestoreAudit = true
    const store = new GoalsMemoryStore({
      createId: () => {
        sequence += 1
        if (failRestoreAudit && sequence === 3) throw new Error('test restore audit failure')
        return `goal-memory-${sequence}`
      },
      now: () => '2026-08-15T12:00:00.000Z',
    }) as GoalRecoveryMemoryStore

    const goal = await store.createGoal('owner-1', { title: '可恢复目标' }, 'goal-create')
    expect(await store.deleteGoal('owner-1', goal.id, 1)).toBe(true)

    await expect(store.restoreGoal('owner-1', goal.id, 2)).rejects.toThrow('test restore audit failure')
    expect(await store.getGoal('owner-1', goal.id)).toBeUndefined()
    expect(await store.listGoalRecoveryAuditEvents('owner-1', 'goal', goal.id)).toEqual([
      expect.objectContaining({
        id: 'goal-memory-2',
        action: 'goal.archive',
        details: { versionBefore: 1, versionAfter: 2, reversesEventId: null },
      }),
    ])

    failRestoreAudit = false
    expect(await store.restoreGoal('owner-1', goal.id, 2)).toMatchObject({
      id: goal.id,
      version: 3,
      deletedAt: null,
    })
    expect(await store.listGoalRecoveryAuditEvents('owner-1', 'goal', goal.id)).toEqual([
      expect.objectContaining({ id: 'goal-memory-2', action: 'goal.archive' }),
      expect.objectContaining({
        action: 'goal.restore',
        details: { versionBefore: 2, versionAfter: 3, reversesEventId: 'goal-memory-2' },
      }),
    ])
  })
})
