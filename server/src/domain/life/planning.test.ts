import { describe, expect, it } from 'vitest'
import {
  calculateFitnessActual,
  copyPlannedDay,
  expandMedicineRecurrence,
  previewTemplateApplication,
  reconcileDayPlanDraft,
  scheduleRelativeToMeal,
  summarizeCalendarDay,
  hasPlanningConflicts,
  summarizeDayProjection,
  transitionPlanItem,
  type DayPlan,
  type LifePlanItem,
  type PlanTemplate,
  type TemplateConflictResolution,
} from './planning.js'

const timestamp = '2026-08-13T09:00:00.000Z'

function item(input: Partial<LifePlanItem> & Pick<LifePlanItem, 'id' | 'kind' | 'title'>): LifePlanItem {
  return {
    mealSlotId: null,
    scheduledTime: null,
    source: null,
    quantity: null,
    unit: null,
    servings: null,
    durationMinutes: null,
    status: 'planned',
    completionId: null,
    actual: null,
    originTemplateItemId: null,
    entityVersion: 1,
    ...input,
  }
}

function plan(items: LifePlanItem[]): DayPlan {
  return {
    id: 'day-1',
    date: '2026-08-18',
    mealSlots: [
      { id: 'breakfast', name: 'Breakfast', position: 0, hidden: false },
      { id: 'brunch', name: 'Brunch', position: 1, hidden: false },
    ],
    items,
    entityVersion: 1,
  }
}

function template(): PlanTemplate {
  return {
    id: 'template-1',
    name: 'Weekday rhythm',
    mealSlots: [{ id: 'brunch', name: 'Brunch', position: 1, hidden: false }],
    items: [item({ id: 'template-breakfast', kind: 'meal', title: 'Template breakfast', mealSlotId: 'breakfast', scheduledTime: '08:00' })],
    entityVersion: 1,
  }
}

describe('planning templates and independent date plans', () => {
  it('reconciles a versioned day-plan draft while preserving immutable completed history', () => {
    const completed = item({
      id: 'completed-meal', kind: 'meal', title: 'Completed breakfast', status: 'completed',
      completionId: 'completion-1', entityVersion: 3,
      actual: {
        source: null, quantity: null, unit: null, servings: 1, completedAt: timestamp,
        nutrition: { energyKcal: 420 }, costMinor: 880, inventoryTransactionIds: ['inventory-1'],
        actualMinutes: null, estimatedEnergyKcal: null, energyIsEstimate: false,
      },
    })
    const original = plan([
      item({ id: 'planned-meal', kind: 'meal', title: 'Original meal', scheduledTime: '08:00', entityVersion: 2 }),
      completed,
    ])
    original.entityVersion = 4

    const updated = reconcileDayPlanDraft({
      dayPlan: original,
      entityVersion: 4,
      mealSlots: [{ id: 'brunch', name: 'Brunch', position: 0, hidden: false }],
      items: [
        { id: 'planned-meal', entityVersion: 2, value: item({ id: 'temporary-1', kind: 'meal', title: 'Edited meal', mealSlotId: 'brunch', scheduledTime: '09:00' }) },
        { id: 'completed-meal', entityVersion: 3, value: item({ id: 'temporary-2', kind: 'meal', title: 'Completed breakfast' }) },
        { value: item({ id: 'new-server-id', kind: 'custom', title: 'New reminder', scheduledTime: '12:00' }) },
      ],
    })

    expect(updated).toMatchObject({ entityVersion: 5, mealSlots: [{ id: 'brunch', name: 'Brunch' }] })
    expect(updated.items).toEqual([
      expect.objectContaining({ id: 'planned-meal', title: 'Edited meal', entityVersion: 3, status: 'planned' }),
      completed,
      expect.objectContaining({ id: 'new-server-id', title: 'New reminder', entityVersion: 1, status: 'planned' }),
    ])
    expect(original.items[0]).toMatchObject({ title: 'Original meal', entityVersion: 2 })
  })

  it('rejects stale plan/item versions and any completed-item edit or removal', () => {
    const completed = item({ id: 'completed', kind: 'meal', title: 'Historical meal', status: 'completed', entityVersion: 2 })
    const original = plan([completed, item({ id: 'planned', kind: 'custom', title: 'Planned', entityVersion: 3 })])
    original.entityVersion = 5
    const proposed = item({ id: 'temporary', kind: 'custom', title: 'Edited' })

    expect(() => reconcileDayPlanDraft({ dayPlan: original, entityVersion: 4, mealSlots: original.mealSlots, items: [] }))
      .toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT', status: 409 }))
    expect(() => reconcileDayPlanDraft({
      dayPlan: original, entityVersion: 5, mealSlots: original.mealSlots,
      items: [{ id: 'completed', entityVersion: 2, value: item({ id: 'temporary-completed', kind: 'meal', title: 'Changed history' }) }, { id: 'planned', entityVersion: 3, value: proposed }],
    })).toThrow(expect.objectContaining({ code: 'COMPLETED_ITEM_IMMUTABLE', status: 409 }))
    expect(() => reconcileDayPlanDraft({
      dayPlan: original, entityVersion: 5, mealSlots: original.mealSlots,
      items: [{ id: 'planned', entityVersion: 2, value: proposed }],
    })).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT', status: 409 }))
    expect(() => reconcileDayPlanDraft({
      dayPlan: original, entityVersion: 5, mealSlots: original.mealSlots,
      items: [{ id: 'planned', entityVersion: 3, value: proposed }],
    })).toThrow(expect.objectContaining({ code: 'COMPLETED_ITEM_IMMUTABLE', status: 409 }))
  })

  it.each([
    ['merge', ['Existing breakfast', 'Template breakfast']],
    ['replace', ['Template breakfast']],
    ['skip', ['Existing breakfast']],
  ] as Array<[TemplateConflictResolution, string[]]>)('requires the explicit %s choice without overwriting the input plan', (resolution, expectedTitles) => {
    const original = plan([item({ id: 'existing-breakfast', kind: 'meal', title: 'Existing breakfast', mealSlotId: 'breakfast', scheduledTime: '08:00' })])
    const preview = previewTemplateApplication({ dayPlan: original, template: template(), resolution })

    expect(preview.writesApplied).toBe(false)
    expect(preview.conflicts).toEqual([expect.objectContaining({
      existingItemIds: ['existing-breakfast'],
      incomingTemplateItemId: 'template-breakfast',
      resolution,
    })])
    expect(preview.result.mealSlots).toContainEqual(expect.objectContaining({ id: 'brunch', name: 'Brunch' }))
    expect(preview.result.items.map((entry) => entry.title)).toEqual(expectedTitles)
    expect(original.items.map((entry) => entry.title)).toEqual(['Existing breakfast'])
  })

  it('never removes completed history when replace resolves a template conflict', () => {
    const completed = item({
      id: 'completed-breakfast',
      kind: 'meal',
      title: 'Completed breakfast',
      mealSlotId: 'breakfast',
      scheduledTime: '08:00',
      status: 'completed',
      completionId: 'completion-1',
      actual: {
        completedAt: timestamp,
        nutrition: { energyKcal: 420 },
        costMinor: 880,
        inventoryTransactionIds: ['inventory-1'],
        actualMinutes: null,
        estimatedEnergyKcal: null,
      },
    })

    const preview = previewTemplateApplication({ dayPlan: plan([completed]), template: template(), resolution: 'replace' })

    expect(preview.result.items.map((entry) => entry.title)).toEqual([
      'Completed breakfast',
      'Template breakfast',
    ])
    expect(preview.result.items[0]).toEqual(completed)
  })

  it('copies only planned structure to another date and removes every actual or completion fact', () => {
    const completed = item({
      id: 'completed-meal',
      kind: 'meal',
      title: 'Historical meal',
      status: 'completed',
      completionId: 'completion-1',
      actual: {
        completedAt: timestamp,
        nutrition: { energyKcal: 420 },
        costMinor: 880,
        inventoryTransactionIds: ['inventory-1'],
        actualMinutes: null,
        estimatedEnergyKcal: null,
      },
    })

    const copied = copyPlannedDay({ source: plan([completed]), targetDate: '2026-08-19', createId: () => 'copied-item' })

    expect(copied.date).toBe('2026-08-19')
    expect(copied.items).toEqual([expect.objectContaining({
      id: 'copied-item', status: 'planned', completionId: null, actual: null,
    })])
    expect(copied.items[0]?.originTemplateItemId).toBe(completed.originTemplateItemId)
  })
})

describe('supplement, medicine and fitness facts', () => {
  it('derives a supplement time from its linked meal and supports offsets across midnight', () => {
    expect(scheduleRelativeToMeal('08:10', 30)).toBe('08:40')
    expect(scheduleRelativeToMeal('23:50', 20)).toBe('00:10')
  })

  it('expands only user-authored medicine recurrence facts without medical advice output', () => {
    const rows = expandMedicineRecurrence({
      mode: 'weekdays',
      weekdays: [1, 3],
      times: ['08:00'],
      startDate: '2026-08-17',
      endDate: '2026-08-23',
    })

    expect(rows).toEqual([
      { date: '2026-08-17', time: '08:00', factual: true },
      { date: '2026-08-19', time: '08:00', factual: true },
    ])
    for (const row of rows) {
      expect(row).not.toHaveProperty('recommendation')
      expect(row).not.toHaveProperty('dosageAdvice')
      expect(row).not.toHaveProperty('interactionAdvice')
    }
    expect(expandMedicineRecurrence({
      mode: 'interval', everyDays: 7, times: ['21:00'], startDate: '2026-08-20', endDate: '2026-08-20',
    })).toEqual([{ date: '2026-08-20', time: '21:00', factual: true }])
    expect(() => expandMedicineRecurrence({
      mode: 'interval', everyDays: 1, times: ['08:00'], startDate: '2026-01-01', endDate: '2027-01-02',
    })).toThrow(expect.objectContaining({ code: 'RECURRENCE_RANGE_TOO_LARGE', status: 400 }))
  })

  it('calculates actual fitness energy from user-authored kcal/hour and actual minutes while preserving a one-off override', () => {
    expect(calculateFitnessActual({ kcalPerHour: 600, actualMinutes: 45 })).toEqual({
      actualMinutes: 45,
      estimatedEnergyKcal: 450,
      userOverride: false,
    })
    expect(calculateFitnessActual({ kcalPerHour: 600, actualMinutes: 45, overrideEnergyKcal: 500 })).toEqual({
      actualMinutes: 45,
      estimatedEnergyKcal: 500,
      userOverride: true,
    })
  })
})

describe('completion state, calendar and projection truth', () => {
  it('supports complete, skip, delay and backfill without mutating the source item', () => {
    const original = item({ id: 'custom-1', kind: 'custom', title: 'Water plants', scheduledTime: '09:00' })

    expect(transitionPlanItem({ item: original, action: 'complete', at: timestamp })).toMatchObject({ status: 'completed' })
    expect(transitionPlanItem({ item: original, action: 'skip', at: timestamp })).toMatchObject({ status: 'skipped' })
    expect(transitionPlanItem({ item: original, action: 'delay', at: timestamp, delayedUntil: '11:30' })).toMatchObject({ status: 'delayed', scheduledTime: '11:30' })
    expect(transitionPlanItem({ item: original, action: 'backfill', at: '2026-08-12T19:00:00.000Z' })).toMatchObject({
      status: 'completed',
      actual: expect.objectContaining({ completedAt: '2026-08-12T19:00:00.000Z' }),
    })
    expect(original).toMatchObject({ status: 'planned', scheduledTime: '09:00', actual: null })
  })

  it('derives planned, complete, past-incomplete and conflicted calendar states from persisted facts', () => {
    const planned = plan([item({ id: 'planned', kind: 'custom', title: 'Planned' })])
    const complete = plan([item({ id: 'complete', kind: 'custom', title: 'Complete', status: 'completed' })])
    expect(summarizeCalendarDay({ plan: planned, today: '2026-08-18', conflicted: false })).toBe('planned')
    expect(summarizeCalendarDay({ plan: complete, today: '2026-08-18', conflicted: false })).toBe('complete')
    expect(summarizeCalendarDay({ plan: planned, today: '2026-08-19', conflicted: false })).toBe('past-incomplete')
    expect(summarizeCalendarDay({ plan: planned, today: '2026-08-18', conflicted: true })).toBe('conflicted')
    expect(hasPlanningConflicts(plan([
      item({ id: 'first', kind: 'custom', title: 'First', mealSlotId: 'breakfast', scheduledTime: '08:00' }),
      item({ id: 'second', kind: 'custom', title: 'Second', mealSlotId: 'breakfast', scheduledTime: '08:00' }),
    ]))).toBe(true)
    expect(hasPlanningConflicts(plan([
      item({ id: 'done', kind: 'custom', title: 'Done', mealSlotId: 'breakfast', scheduledTime: '08:00', status: 'completed' }),
      item({ id: 'next', kind: 'custom', title: 'Next', mealSlotId: 'breakfast', scheduledTime: '08:00' }),
    ]))).toBe(false)
    expect(hasPlanningConflicts(plan([
      item({ id: 'medicine-a', kind: 'medicine', title: 'Medicine A', scheduledTime: '08:00', source: { type: 'catalog-item', id: 'medicine-a' } }),
      item({ id: 'medicine-b', kind: 'medicine', title: 'Medicine B', scheduledTime: '08:00', source: { type: 'catalog-item', id: 'medicine-b' } }),
    ]))).toBe(false)
    expect(hasPlanningConflicts(plan([
      item({ id: 'medicine-a-first', kind: 'medicine', title: 'Medicine A', scheduledTime: '08:00', source: { type: 'catalog-item', id: 'medicine-a' } }),
      item({ id: 'medicine-a-second', kind: 'medicine', title: 'Medicine A duplicate', scheduledTime: '08:00', source: { type: 'catalog-item', id: 'medicine-a' } }),
    ]))).toBe(true)
  })

  it('keeps future projections separate from immutable completed snapshots and reports missing planned facts', () => {
    const result = summarizeDayProjection({
      planned: [
        { sourceId: 'recipe-version-2', nutrition: { energyKcal: 500, proteinGrams: 30 }, costMinor: 1_200 },
        { sourceId: 'supplement-1', nutrition: null, costMinor: null },
      ],
      completed: [{
        source: { type: 'recipe-version', id: 'recipe-1', versionId: 'recipe-version-2' },
        quantity: null,
        unit: null,
        servings: 1,
        completedAt: timestamp,
        nutrition: { energyKcal: 420, proteinGrams: 27 },
        costMinor: 980,
        inventoryTransactionIds: ['consume-1'],
        actualMinutes: null,
        estimatedEnergyKcal: null,
        energyIsEstimate: false,
      }],
    })

    expect(result).toEqual({
      status: 'incomplete',
      plannedNutrition: null,
      actualNutrition: { energyKcal: 420, proteinGrams: 27 },
      plannedCostMinor: null,
      actualCostMinor: 980,
      sourceIds: ['recipe-version-2', 'supplement-1'],
    })
  })
})
