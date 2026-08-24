import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  DayPlan,
  DayPlanProjection,
  FitnessActivity,
  MedicineRecurrenceOccurrence,
  MedicineRecurrenceRule,
  PlanTemplate,
  PlanningCompletionSnapshot,
  PlanningTimeline,
  TemplateApplicationPreview,
} from '../domain/lifePlanning'
import { http } from './httpClient'
import { lifePlanningApi } from './lifePlanningApi'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))
const request = vi.mocked(http.request)
const invalidate = vi.mocked(queryClient.invalidateQueries)
const occurrenceApi = lifePlanningApi

describe('lifePlanningApi', () => {
  beforeEach(() => { request.mockReset(); request.mockResolvedValue(undefined); invalidate.mockClear() })

  it('uses cancellable encoded planning, projection, calendar and fitness reads', async () => {
    const signal = new AbortController().signal
    await lifePlanningApi.listTemplates(signal)
    await lifePlanningApi.getDayPlan('2026/08/20', signal)
    await lifePlanningApi.getDayProjection('2026/08/20', signal)
    await lifePlanningApi.listCalendar({ from: '2026-08-01', to: '2026-08-31', today: '2026-08-20' }, signal)
    await lifePlanningApi.listMedicineRecurrenceRules(signal)
    await lifePlanningApi.listFitness(signal)
    expect(request.mock.calls).toEqual([
      ['/life/templates', { signal }],
      ['/life/day-plans/2026%2F08%2F20', { signal }],
      ['/life/day-plans/2026%2F08%2F20/projection', { signal }],
      ['/life/calendar?from=2026-08-01&to=2026-08-31&today=2026-08-20', { signal }],
      ['/life/day-plans/recurrence-rules', { signal }],
      ['/life/fitness', { signal }],
    ])
  })

  it('reads merged occurrence timelines and sends versioned idempotent occurrence transitions', async () => {
    const signal = new AbortController().signal
    await occurrenceApi.getTimeline('2026/08/20', signal)
    await occurrenceApi.transitionMedicineOccurrence('occurrence/one', {
      entityVersion: 3,
      action: 'delay',
      at: '2026-08-16T10:00:00.000Z',
      delayedUntil: { date: '2026-08-20', time: '10:30' },
    }, 'delay-occurrence', 'csrf')
    await lifePlanningApi.createCompletion({
      medicineOccurrenceId: 'occurrence/one',
      medicineOccurrenceVersion: 4,
      completedAt: '2026-08-20T10:35:00.000Z',
    }, 'complete-occurrence', 'csrf')

    expect(request.mock.calls).toEqual([
      ['/life/timeline/2026%2F08%2F20', { signal }],
      ['/life/day-plans/medicine-occurrences/occurrence%2Fone', {
        method: 'PATCH',
        body: {
          entityVersion: 3,
          action: 'delay',
          at: '2026-08-16T10:00:00.000Z',
          delayedUntil: { date: '2026-08-20', time: '10:30' },
        },
        csrf: 'csrf',
        idempotencyKey: 'delay-occurrence',
      }],
      ['/life/completions', {
        method: 'POST',
        body: {
          medicineOccurrenceId: 'occurrence/one',
          medicineOccurrenceVersion: 4,
          completedAt: '2026-08-20T10:35:00.000Z',
        },
        csrf: 'csrf',
        idempotencyKey: 'complete-occurrence',
      }],
    ])
  })

  it('keeps previews non-mutating while preserving CSRF on their POST requests', async () => {
    await lifePlanningApi.previewTemplate('2026/08/20', { templateId: 'template/one', resolution: 'merge' }, 'csrf')
    await lifePlanningApi.previewSync('template/one', { fromDate: '2026-08-20', target: 'selected', dates: ['2026-08-21'] }, 'csrf')
    await lifePlanningApi.previewMedicineRecurrence({
      kind: 'medicine', source: { type: 'catalog-item', id: 'medicine/one' },
      recurrence: { mode: 'weekdays', weekdays: [1, 3], times: ['08:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
    }, 'csrf')
    expect(request.mock.calls).toEqual([
      ['/life/day-plans/2026%2F08%2F20/template-preview', { method: 'POST', body: { templateId: 'template/one', resolution: 'merge' }, csrf: 'csrf' }],
      ['/life/templates/template%2Fone/sync-preview', { method: 'POST', body: { fromDate: '2026-08-20', target: 'selected', dates: ['2026-08-21'] }, csrf: 'csrf' }],
      ['/life/day-plans/recurrence-preview', { method: 'POST', body: {
        kind: 'medicine', source: { type: 'catalog-item', id: 'medicine/one' },
        recurrence: { mode: 'weekdays', weekdays: [1, 3], times: ['08:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
      }, csrf: 'csrf' }],
    ])
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('preserves version, CSRF, idempotency and encoded identities across planning writes', async () => {
    const template = { name: 'Weekday', mealSlots: [], items: [] }
    const day = { date: '2026-08-20', mealSlots: [], items: [] }
    await lifePlanningApi.createTemplate(template, 'create-template', 'csrf')
    await lifePlanningApi.updateTemplate('template/one', { ...template, entityVersion: 1 }, 'csrf')
    await lifePlanningApi.createDayPlan(day, 'create-day', 'csrf')
    const updateDayPlan = (lifePlanningApi as unknown as {
      updateDayPlan: (date: string, input: unknown, csrf?: string) => Promise<unknown>
    }).updateDayPlan
    expect(typeof updateDayPlan).toBe('function')
    await updateDayPlan('2026/08/20', { entityVersion: 1, mealSlots: [], items: [] }, 'csrf')
    await lifePlanningApi.applyTemplate('2026/08/20', { templateId: 'template/one', resolution: 'replace', entityVersion: 1, templateVersion: 2 }, 'apply-template', 'csrf')
    await lifePlanningApi.copyDayPlan('2026/08/20', '2026-08-21', 'copy-day', 'csrf')
    await lifePlanningApi.transitionItem('2026/08/20', 'item/one', { entityVersion: 1, action: 'delay', at: '2026-08-20T08:00:00.000Z', delayedUntil: '09:00' }, 'csrf')
    await lifePlanningApi.syncTemplate('template/one', { fromDate: '2026-08-20', target: 'future-incomplete', templateVersion: 2, dayPlanVersions: { '2026-08-20': 3 } }, 'sync-template', 'csrf')
    const recurrenceRule = {
      title: 'Medicine schedule', sourceId: 'medicine/one', quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval' as const, everyDays: 2, times: ['09:00'], startDate: '2026-08-20', endDate: '2026-08-30' },
    }
    await lifePlanningApi.createMedicineRecurrenceRule(recurrenceRule, 'create-recurrence', 'csrf')
    await lifePlanningApi.updateMedicineRecurrenceRule('rule/one', { ...recurrenceRule, entityVersion: 1 }, 'csrf')
    await lifePlanningApi.deleteMedicineRecurrenceRule('rule/one', 2, 'csrf')
    await lifePlanningApi.createFitness({ name: 'Cycle', defaultMinutes: 30, kcalPerHour: 500, intensity: 'moderate', steps: [], equipment: [] }, 'create-fitness', 'csrf')
    await lifePlanningApi.createCompletion({ date: '2026-08-20', dayPlanItemId: 'item/one', completedAt: '2026-08-20T08:30:00.000Z' }, 'complete-item', 'csrf')
    await lifePlanningApi.undoCompletion('completion/one', 'undo-item', 'csrf')
    expect(request.mock.calls).toEqual([
      ['/life/templates', { method: 'POST', body: template, csrf: 'csrf', idempotencyKey: 'create-template' }],
      ['/life/templates/template%2Fone', { method: 'PATCH', body: { ...template, entityVersion: 1 }, csrf: 'csrf' }],
      ['/life/day-plans', { method: 'POST', body: day, csrf: 'csrf', idempotencyKey: 'create-day' }],
      ['/life/day-plans/2026%2F08%2F20', { method: 'PATCH', body: { entityVersion: 1, mealSlots: [], items: [] }, csrf: 'csrf' }],
      ['/life/day-plans/2026%2F08%2F20/apply-template', { method: 'POST', body: { templateId: 'template/one', resolution: 'replace', entityVersion: 1, templateVersion: 2 }, csrf: 'csrf', idempotencyKey: 'apply-template' }],
      ['/life/day-plans/2026%2F08%2F20/copy', { method: 'POST', body: { targetDate: '2026-08-21' }, csrf: 'csrf', idempotencyKey: 'copy-day' }],
      ['/life/day-plans/2026%2F08%2F20/items/item%2Fone', { method: 'PATCH', body: { entityVersion: 1, action: 'delay', at: '2026-08-20T08:00:00.000Z', delayedUntil: '09:00' }, csrf: 'csrf' }],
      ['/life/templates/template%2Fone/sync', { method: 'POST', body: { fromDate: '2026-08-20', target: 'future-incomplete', templateVersion: 2, dayPlanVersions: { '2026-08-20': 3 } }, csrf: 'csrf', idempotencyKey: 'sync-template' }],
      ['/life/day-plans/recurrence-rules', { method: 'POST', body: recurrenceRule, csrf: 'csrf', idempotencyKey: 'create-recurrence' }],
      ['/life/day-plans/recurrence-rules/rule%2Fone', { method: 'PATCH', body: { ...recurrenceRule, entityVersion: 1 }, csrf: 'csrf' }],
      ['/life/day-plans/recurrence-rules/rule%2Fone', { method: 'DELETE', body: { entityVersion: 2 }, csrf: 'csrf' }],
      ['/life/fitness', { method: 'POST', body: { name: 'Cycle', defaultMinutes: 30, kcalPerHour: 500, intensity: 'moderate', steps: [], equipment: [] }, csrf: 'csrf', idempotencyKey: 'create-fitness' }],
      ['/life/completions', { method: 'POST', body: { date: '2026-08-20', dayPlanItemId: 'item/one', completedAt: '2026-08-20T08:30:00.000Z' }, csrf: 'csrf', idempotencyKey: 'complete-item' }],
      ['/life/completions/completion%2Fone/undo', { method: 'POST', body: {}, csrf: 'csrf', idempotencyKey: 'undo-item' }],
    ])
  })

  it('awaits planning, inventory, catalog and recipe invalidation after confirmed writes', async () => {
    await lifePlanningApi.createCompletion({ date: '2026-08-20', dayPlanItemId: 'item', completedAt: '2026-08-20T08:30:00.000Z' }, 'complete', 'csrf')
    expect(invalidate.mock.calls.map(([value]) => value)).toEqual([
      { queryKey: queryKeys.lifePlanning.all },
      { queryKey: queryKeys.lifeInventory.all },
      { queryKey: queryKeys.lifeCatalog.all },
      { queryKey: queryKeys.lifeRecipes.all },
    ])
  })

  it('exposes full planning, projection, conflict, fitness and completion contracts', () => {
    expectTypeOf<PlanTemplate>().toHaveProperty('entityVersion')
    expectTypeOf<DayPlan>().toHaveProperty('items')
    expectTypeOf<TemplateApplicationPreview>().toHaveProperty('conflicts')
    expectTypeOf<TemplateApplicationPreview>().toHaveProperty('templateVersion')
    expectTypeOf<TemplateApplicationPreview>().toHaveProperty('dayPlanVersion')
    expectTypeOf<DayPlanProjection>().toHaveProperty('inventory')
    expectTypeOf<DayPlanProjection['items'][number]>().toHaveProperty('preparedFood')
    expectTypeOf<FitnessActivity>().toHaveProperty('kcalPerHour')
    expectTypeOf<MedicineRecurrenceRule>().toHaveProperty('entityVersion')
    expectTypeOf<MedicineRecurrenceOccurrence>().toHaveProperty('originalDate')
    expectTypeOf<PlanningTimeline['timelineItems'][number]>().toHaveProperty('sourceType')
    expectTypeOf<PlanningCompletionSnapshot>().toHaveProperty('inventoryTransactionIds')
    expectTypeOf<PlanningCompletionSnapshot>().toHaveProperty('completionSource')
  })
})
