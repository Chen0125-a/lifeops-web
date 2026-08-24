import { describe, expect, it, vi } from 'vitest'
import {
  DataTransferError,
  DataTransferService,
  checksumDataTransfer,
  type DataTransferOwnedData,
  type DataTransferPort,
} from './dataTransfer.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

const ownedData = (): DataTransferOwnedData => ({
  original: {
    goals: [{ id: 'goal-1', title: 'Ship LifeOps' }],
    projects: [{ id: 'project-1', goalId: 'goal-1', title: 'Web delivery' }],
    milestones: [{ id: 'milestone-1', projectId: 'project-1', title: 'P5' }],
    tasks: [{ id: 'task-1', goalId: 'goal-1', projectId: 'project-1', milestoneId: 'milestone-1', title: 'Settings' }],
    scheduleBlocks: [{ id: 'block-1', taskId: 'task-1', startsAt: '2026-08-23T09:00:00.000Z', endsAt: '2026-08-23T10:00:00.000Z' }],
    habits: [{ id: 'habit-1', goalId: 'goal-1', projectId: 'project-1', title: 'Review daily' }],
    habitEntries: [{ id: 'habit-entry-1', habitId: 'habit-1', entryDate: '2026-08-23', status: 'done' }],
    records: [{ id: 'record-1', links: [{ type: 'project', id: 'project-1' }], title: 'Decision' }],
    reviews: [{ id: 'review-1', title: 'Weekly review' }],
    knowledge: [{ id: 'knowledge-1', sourceLinks: [{ type: 'record', id: 'record-1' }], title: 'Runbook' }],
    publications: [{ id: 'publication-1', sourceType: 'knowledge', sourceId: 'knowledge-1', title: 'Public runbook' }],
    trash: [{ entityType: 'record', entityId: 'record-old' }],
  },
  life: {
    catalogTaxonomy: [{ id: 'category-1', kind: 'category', parentId: null }],
    lifeUnits: [{ id: 'unit-1', code: 'g' }],
    catalogItems: [{ id: 'item-1', categoryId: 'category-1', baseUnit: 'g' }],
    recipeVersions: [{ id: 'recipe-version-1', recipeId: 'recipe-1', components: [{ itemId: 'item-1', unit: 'g' }] }],
    recipes: [{ id: 'recipe-1', currentVersionId: 'recipe-version-1' }],
    dayPlans: [{ id: 'day-plan-1', items: [{ id: 'plan-item-1', source: { type: 'recipe', id: 'recipe-1' } }] }],
    completionSnapshots: [{ id: 'completion-1', dayPlanId: 'day-plan-1', dayPlanItemId: 'plan-item-1' }],
    inventoryTransactions: [{ id: 'inventory-1', itemId: 'item-1', reversesTransactionId: null }],
    purchases: [{ id: 'purchase-1' }],
    budgets: [{ id: 'budget-1' }],
    trashReferences: [{ entityType: 'catalog-item', entityId: 'item-old' }],
  },
  settings: {
    appearance: { theme: 'system', motion: 'system' },
    locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
  },
})

function port(data = ownedData()): DataTransferPort & {
  applied: DataTransferOwnedData[]
  restorePoints: Array<{ id: string; checksumSha256: string; canonicalJson: string }>
} {
  const applied: DataTransferOwnedData[] = []
  const restorePoints: Array<{ id: string; checksumSha256: string; canonicalJson: string }> = []
  return {
    applied,
    restorePoints,
    readOwnedData: vi.fn(async () => structuredClone(data)),
    applyOwnedData: vi.fn(async (_userId, next) => { applied.push(structuredClone(next)) }),
    persistDataTransferRestorePoint: vi.fn(async (_userId: string, snapshot: { checksumSha256: string; canonicalJson: string }) => {
      const restorePoint = { id: `restore-${restorePoints.length + 1}`, checksumSha256: snapshot.checksumSha256, canonicalJson: snapshot.canonicalJson }
      restorePoints.push(restorePoint)
      return { id: restorePoint.id, checksumSha256: restorePoint.checksumSha256, createdAt: '2026-08-23T02:31:00.000Z' }
    }),
    transaction: vi.fn(async (_userId: string, work: () => Promise<unknown>) => {
      const before = applied.length
      try { return await work() } catch (error) { applied.splice(before); throw error }
    }) as DataTransferPort['transaction'],
  } as DataTransferPort & { applied: DataTransferOwnedData[]; restorePoints: Array<{ id: string; checksumSha256: string; canonicalJson: string }> }
}

describe('DataTransferService export', () => {
  it('exports every original and Life collection deterministically without authentication or platform secrets', async () => {
    const data = ownedData() as DataTransferOwnedData & Record<string, unknown>
    data.passwordHash = 'never-export-password-hash'
    data.sessionTokens = ['never-export-session-token']
    data.csrfToken = 'never-export-csrf'
    data.loginLimits = [{ key: 'never-export-limit' }]
    data.platformCredentials = { token: 'never-export-platform-token' }
    data.rawSanitizedLogSamples = [{ message: 'never-export-raw-log' }]
    const service = new DataTransferService(port(data), { now: () => '2026-08-23T02:30:00.000Z' })

    const first = await service.export('owner-1')
    const second = await service.export('owner-1')

    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe(1)
    expect(first.checksumSha256).toBe(checksumDataTransfer(first.canonicalJson))
    expect(first.counts).toMatchObject({ goals: 1, projects: 1, scheduleBlocks: 1, habitEntries: 1, records: 1, catalogItems: 1, recipeVersions: 1, inventoryTransactions: 1, purchases: 1, budgets: 1 })
    expect(first.canonicalJson).toContain('Ship LifeOps')
    expect(first.canonicalJson).not.toMatch(/never-export|passwordHash|sessionTokens|csrfToken|loginLimits|platformCredentials|rawSanitizedLogSamples/)
  })
})

describe('DataTransferService import', () => {
  it('previews ownership remap, ordered relations, counts and conflicts without writing', async () => {
    const adapter = port()
    const service = new DataTransferService(adapter, { now: () => '2026-08-23T02:30:00.000Z' })
    const exported = await service.export('source-owner')

    const preview = await service.preview('target-owner', {
      canonicalJson: exported.canonicalJson,
      checksumSha256: exported.checksumSha256,
      existingIds: ['goal-1', 'item-1'],
    })

    expect(preview.status).toBe('conflicts')
    expect(preview.ownerRemap).toEqual({ source: 'source-owner', target: 'target-owner' })
    expect(preview.counts.goals).toBe(1)
    expect(preview.conflicts.map((row) => row.id)).toEqual(['goal-1', 'item-1'])
    expect(preview.rejectedRecords).toEqual([])
    expect(adapter.applyOwnedData).not.toHaveBeenCalled()
  })

  it.each([
    ['schema version', (value: Record<string, unknown>) => { value.schemaVersion = 99 }, 'IMPORT_VERSION_UNSUPPORTED'],
    ['missing goal relation', (value: Record<string, unknown>) => { (value.data as DataTransferOwnedData).original.projects[0]!.goalId = 'missing-goal' }, 'IMPORT_RELATION_MISSING'],
    ['recipe version relation', (value: Record<string, unknown>) => { (value.data as DataTransferOwnedData).life.recipeVersions[0]!.recipeId = 'missing-recipe' }, 'IMPORT_RELATION_MISSING'],
    ['inventory ledger relation', (value: Record<string, unknown>) => { (value.data as DataTransferOwnedData).life.inventoryTransactions[0]!.itemId = 'missing-item' }, 'IMPORT_RELATION_MISSING'],
    ['schedule block relation', (value: Record<string, unknown>) => { (value.data as DataTransferOwnedData).original.scheduleBlocks[0]!.taskId = 'missing-task' }, 'IMPORT_RELATION_MISSING'],
    ['habit entry relation', (value: Record<string, unknown>) => { (value.data as DataTransferOwnedData).original.habitEntries[0]!.habitId = 'missing-habit' }, 'IMPORT_RELATION_MISSING'],
    ['duplicate ID in one collection', (value: Record<string, unknown>) => {
      const original = (value.data as DataTransferOwnedData).original
      original.tasks.push({ ...structuredClone(original.tasks[0]!), title: 'Duplicate identity' })
    }, 'INVALID_IMPORT'],
    ['recipe/item/version ID collision', (value: Record<string, unknown>) => { (value.data as DataTransferOwnedData).life.recipeVersions[0]!.id = 'item-1' }, 'INVALID_IMPORT'],
    ['inventory reversal item mismatch', (value: Record<string, unknown>) => {
      const life = (value.data as DataTransferOwnedData).life
      life.catalogItems.push({ id: 'item-2', categoryId: 'category-1', baseUnit: 'g' })
      life.inventoryTransactions.push({ id: 'inventory-2', itemId: 'item-2', reversesTransactionId: 'inventory-1' })
    }, 'INVALID_IMPORT'],
  ])('rejects invalid %s during preview', async (_label, mutate, code) => {
    const adapter = port()
    const service = new DataTransferService(adapter)
    const exported = await service.export('source-owner')
    const parsed = JSON.parse(exported.canonicalJson) as Record<string, unknown>
    mutate(parsed)
    const canonicalJson = JSON.stringify(parsed)

    await expect(service.preview('target-owner', { canonicalJson, checksumSha256: checksumDataTransfer(canonicalJson) }))
      .rejects.toMatchObject({ code })
    expect(adapter.applyOwnedData).not.toHaveBeenCalled()
  })

  it('rejects checksum drift and applies only the exact preview checksum after current-password authorization', async () => {
    const adapter = port()
    let generated = 0
    const service = new DataTransferService(adapter, { createId: () => `remapped-${++generated}` })
    const exported = await service.export('source-owner')

    await expect(service.preview('target-owner', { canonicalJson: exported.canonicalJson, checksumSha256: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'IMPORT_CHECKSUM_MISMATCH' })

    const preview = await service.preview('target-owner', { canonicalJson: exported.canonicalJson, checksumSha256: exported.checksumSha256 })
    await expect(service.apply('target-owner', {
      previewChecksum: 'F'.repeat(64),
      currentPassword: 'correct-current-password',
    }, async () => true)).rejects.toMatchObject({ code: 'IMPORT_PREVIEW_STALE' })
    await expect(service.apply('target-owner', {
      previewChecksum: preview.previewChecksum,
      currentPassword: 'wrong-current-password',
    }, async () => false)).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })

    const applied = await service.apply('target-owner', {
      previewChecksum: preview.previewChecksum,
      currentPassword: 'correct-current-password',
    }, async () => true)
    expect(applied).toEqual({
      applied: true,
      counts: preview.counts,
      restorePoint: { id: 'restore-1', checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/), createdAt: '2026-08-23T02:31:00.000Z' },
    })
    expect(adapter.applied).toHaveLength(1)
    expect(adapter.restorePoints).toHaveLength(1)
    expect(checksumDataTransfer(adapter.restorePoints[0]!.canonicalJson)).toBe(adapter.restorePoints[0]!.checksumSha256)
    expect(adapter.applied[0]!.original.goals[0]!.id).not.toBe('goal-1')
    expect(adapter.applied[0]!.original.projects[0]!.goalId).toBe(adapter.applied[0]!.original.goals[0]!.id)
    expect(adapter.transaction).toHaveBeenCalledWith('target-owner', expect.any(Function))
  })

  it('rolls back the complete apply transaction when the store fails after partial work', async () => {
    const adapter = port()
    adapter.applyOwnedData = vi.fn(async (_userId, next) => {
      adapter.applied.push(structuredClone(next))
      throw new Error('foreign key apply failure')
    })
    const service = new DataTransferService(adapter)
    const exported = await service.export('source-owner')
    const preview = await service.preview('target-owner', { canonicalJson: exported.canonicalJson, checksumSha256: exported.checksumSha256 })

    await expect(service.apply('target-owner', {
      previewChecksum: preview.previewChecksum,
      currentPassword: 'correct-current-password',
    }, async () => true)).rejects.toThrow('foreign key apply failure')
    expect(adapter.applied).toEqual([])
    expect(adapter.restorePoints).toHaveLength(1)
    expect(checksumDataTransfer(adapter.restorePoints[0]!.canonicalJson)).toBe(adapter.restorePoints[0]!.checksumSha256)
  })

  it('replaces real Memory original-domain, Life and settings state for the target owner', async () => {
    let sourceId = 0
    const sourceStore = new MemoryLifeStore({ createId: () => `source-${++sourceId}`, now: () => '2026-08-23T03:00:00.000Z' })
    await sourceStore.createGoal('source-owner', { title: 'Imported goal', manualProgress: 42 }, 'source-goal')
    await sourceStore.updateUserSettings('source-owner', { version: 1, appearance: { theme: 'dark', motion: 'reduce' } })
    const sourceService = new DataTransferService(sourceStore, { now: () => '2026-08-23T03:01:00.000Z' })
    const exported = await sourceService.export('source-owner')

    let targetId = 0
    const targetStore = new MemoryLifeStore({ createId: () => `target-${++targetId}`, now: () => '2026-08-23T03:02:00.000Z' })
    await targetStore.createGoal('target-owner', { title: 'Replace me' }, 'target-goal')
    const targetService = new DataTransferService(targetStore)
    const preview = await targetService.preview('target-owner', { canonicalJson: exported.canonicalJson, checksumSha256: exported.checksumSha256 })
    await targetService.apply('target-owner', { previewChecksum: preview.previewChecksum, currentPassword: 'correct' }, async () => true)

    expect((await targetStore.listGoals('target-owner')).map((goal) => goal.title)).toEqual(['Imported goal'])
    expect(await targetStore.getUserSettings('target-owner')).toMatchObject({ appearance: { theme: 'dark', motion: 'reduce' } })
    const targetLife = (await targetStore.readOwnedData('target-owner')).life
    const sourceLife = (await sourceStore.readOwnedData('source-owner')).life
    expect(Object.fromEntries(Object.entries(targetLife).map(([key, rows]) => [key, rows.length])))
      .toEqual(Object.fromEntries(Object.entries(sourceLife).map(([key, rows]) => [key, rows.length])))
  })

  it('carries deleted original records as restorable trash instead of exporting identity-only tombstones', async () => {
    let sourceId = 0
    const sourceStore = new MemoryLifeStore({ createId: () => `trash-source-${++sourceId}` })
    const deleted = await sourceStore.createRecord('source-owner', {
      title: 'Deleted but portable', body: 'The restore payload must keep this body.', occurredAt: '2026-08-23T03:00:00.000Z',
    })
    await sourceStore.deleteRecord('source-owner', deleted.id, deleted.version)
    const exported = await new DataTransferService(sourceStore).export('source-owner')
    expect(exported.canonicalJson).toContain('Deleted but portable')

    let targetId = 0
    const targetStore = new MemoryLifeStore({ createId: () => `trash-target-${++targetId}` })
    const targetTransfer = new DataTransferService(targetStore, { createId: () => `trash-remap-${++targetId}` })
    const preview = await targetTransfer.preview('target-owner', { canonicalJson: exported.canonicalJson, checksumSha256: exported.checksumSha256 })
    await targetTransfer.apply('target-owner', { previewChecksum: preview.previewChecksum, currentPassword: 'correct' }, async () => true)

    const imported = (await targetStore.readOwnedData('target-owner')).original.records.find((record) => record.title === 'Deleted but portable')!
    expect(imported.deletedAt).toEqual(expect.any(String))
    await expect(targetStore.restoreRecord('target-owner', imported.id, imported.version)).resolves.toMatchObject({
      title: 'Deleted but portable', body: 'The restore payload must keep this body.', deletedAt: null,
    })
  })

  it('restores real Memory original-domain, Life and settings state when a later apply phase fails', async () => {
    let sourceId = 0
    const sourceStore = new MemoryLifeStore({ createId: () => `rollback-source-${++sourceId}` })
    await sourceStore.createGoal('source-owner', { title: 'Incoming goal' }, 'source-goal')
    const exported = await new DataTransferService(sourceStore).export('source-owner')

    let targetId = 0
    const targetStore = new MemoryLifeStore({
      createId: () => `rollback-target-${++targetId}`,
      transactionObserver: ({ operation, phase }) => {
        if (operation === 'data-transfer:apply' && phase === 'life-data-replaced') throw new Error('injected late apply failure')
      },
    })
    await targetStore.createGoal('target-owner', { title: 'Keep me' }, 'target-goal')
    await targetStore.updateUserSettings('target-owner', { version: 1, appearance: { theme: 'light', motion: 'system' } })
    const targetService = new DataTransferService(targetStore)
    const preview = await targetService.preview('target-owner', { canonicalJson: exported.canonicalJson, checksumSha256: exported.checksumSha256 })

    await expect(targetService.apply('target-owner', { previewChecksum: preview.previewChecksum, currentPassword: 'correct' }, async () => true))
      .rejects.toThrow('injected late apply failure')
    expect((await targetStore.listGoals('target-owner')).map((goal) => goal.title)).toEqual(['Keep me'])
    expect(await targetStore.getUserSettings('target-owner')).toMatchObject({ appearance: { theme: 'light' } })
  })

  it('uses stable typed errors', () => {
    expect(new DataTransferError('INVALID_IMPORT', 'bad import', 400)).toMatchObject({ code: 'INVALID_IMPORT', statusCode: 400 })
  })
})
