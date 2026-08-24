import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import type { DayPlan } from '../domain/life/planning.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
  writeWithoutCsrf(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('life planning routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `planning-test-${++sequence}`,
      now: () => '2026-08-13T09:00:00.000Z',
    })
    await store.createUser({ account: 'owner@example.com', displayName: 'Owner', passwordHash: await hashPassword('owner-safe-password') })
    await store.createUser({ account: 'other@example.com', displayName: 'Other', passwordHash: await hashPassword('other-safe-password') })
    app = buildApp({ store, config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3_600, secureCookies: false } })
    await app.ready()
  })

  afterEach(async () => app.close())

  async function client(account = 'owner@example.com', password = 'owner-safe-password'): Promise<Client> {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account, password } })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrf = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options, idempotencyKey) => app.inject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          'x-csrf-token': csrf,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      }),
      writeWithoutCsrf: (options, idempotencyKey) => app.inject({
        ...options,
        headers: { ...options.headers, cookie, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      }),
    }
  }

  async function createCatalogItem(
    subject: Client,
    kind: 'supplement' | 'medicine',
    name: string,
    baseUnit: string,
  ) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind,
        name,
        baseUnit,
        availableUnits: [baseUnit],
        aliases: [],
        tagIds: [],
        ...(kind === 'medicine' ? {
          medicine: {
            tradeName: name,
            specification: 'User-entered package facts',
            userScheduleText: 'User-authored reminder facts',
          },
        } : {}),
      },
    }, `catalog-${kind}-${name}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>()
  }

  async function createTemplate(subject: Client, title = 'Template breakfast') {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/templates',
      payload: {
        name: 'Weekday rhythm',
        mealSlots: [
          { id: 'breakfast', name: 'Breakfast', position: 0, hidden: false },
          { id: 'brunch', name: 'Brunch', position: 1, hidden: false },
        ],
        items: [{
          kind: 'custom', title, mealSlotId: 'breakfast', scheduledTime: '08:00', weekdays: [1, 2, 3, 4, 5],
          source: null, quantity: null, unit: null, servings: null, durationMinutes: null,
        }],
      },
    }, `template-${title}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; entityVersion: number; items: Array<{ id: string }> }>()
  }

  async function createDay(subject: Client, date: string, items: Array<Record<string, unknown>>) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/day-plans',
      payload: {
        date,
        mealSlots: [
          { id: 'breakfast', name: 'Breakfast', position: 0, hidden: false },
          { id: 'brunch', name: 'Brunch', position: 1, hidden: false },
        ],
        items,
      },
    }, `day-${date}`)
    expect(response.statusCode).toBe(201)
    return response.json<DayPlan>()
  }

  const customItem = (title: string, mealSlotId: string | null = null) => ({
    kind: 'custom', title, mealSlotId, scheduledTime: '08:00', source: null,
    quantity: null, unit: null, servings: null, durationMinutes: null,
  })

  interface MedicineOccurrenceTimelineItem {
    sourceType: 'medicine-occurrence'
    id: string
    ruleId: string
    entityVersion: number
    kind: 'medicine'
    title: string
    source: { type: 'catalog-item'; id: string }
    quantity: number
    unit: string
    originalDate: string
    originalTime: string
    scheduledDate: string
    scheduledTime: string
    status: 'planned' | 'completed' | 'skipped' | 'cancelled'
    completionId: string | null
    updatedAt: string
  }

  interface PlanningTimelineResponse {
    date: string
    timelineItems: Array<MedicineOccurrenceTimelineItem | {
      sourceType: 'day-plan-item'
      id: string
      scheduledTime: string | null
      status: string
    }>
  }

  const medicineRuleInput = (
    sourceId: string,
    options: {
      title?: string
      times?: string[]
      startDate?: string
      endDate?: string
    } = {},
  ) => ({
    title: options.title ?? 'User-authored medicine schedule',
    sourceId,
    quantity: 1,
    unit: 'tablet',
    recurrence: {
      mode: 'interval' as const,
      everyDays: 1,
      times: options.times ?? ['08:00'],
      startDate: options.startDate ?? '2026-08-17',
      endDate: options.endDate ?? '2026-08-19',
    },
  })

  const medicineTimes = (count: number) => Array.from({ length: count }, (_, index) => (
    `${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`
  ))

  async function createMedicineRule(
    subject: Client,
    sourceId: string,
    options: Parameters<typeof medicineRuleInput>[1] = {},
    idempotencyKey = 'create-occurrence-rule',
  ) {
    const input = medicineRuleInput(sourceId, options)
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/day-plans/recurrence-rules',
      payload: input,
    }, idempotencyKey)
    expect(response.statusCode).toBe(201)
    return {
      input,
      rule: response.json<{ id: string; entityVersion: number }>(),
    }
  }

  async function readTimeline(subject: Client, date: string) {
    const response = await subject.get(`/api/v1/life/timeline/${date}`)
    const body = response.json<PlanningTimelineResponse>()
    return { response, body }
  }

  function occurrenceAt(body: PlanningTimelineResponse, time: string): MedicineOccurrenceTimelineItem {
    const occurrence = body.timelineItems?.find((entry): entry is MedicineOccurrenceTimelineItem => (
      entry.sourceType === 'medicine-occurrence' && entry.originalTime === time
    ))
    if (!occurrence) {
      throw new Error(`Expected medicine occurrence at ${body.date} ${time}`)
    }
    return occurrence
  }

  async function stockMedicine(subject: Client, itemId: string, key: string) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/inventory/transactions',
      payload: { itemId, kind: 'purchase', quantity: 10, unit: 'tablet', occurredAt: '2026-08-13T08:00:00.000Z' },
    }, key)
    expect(response.statusCode).toBe(201)
  }

  it('requires authentication and CSRF while keeping templates and day plans owner scoped', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/life/templates' })).statusCode).toBe(401)
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const input = {
      method: 'POST' as const,
      url: '/api/v1/life/templates',
      payload: { name: 'Protected', mealSlots: [], items: [] },
    }
    expect((await owner.writeWithoutCsrf(input, 'protected-template')).statusCode).toBe(403)
    expect((await owner.write(input, 'protected-template')).statusCode).toBe(201)
    expect((await owner.get('/api/v1/life/templates')).json()).toHaveLength(1)
    expect((await other.get('/api/v1/life/templates')).json()).toEqual([])
    expect((await other.get('/api/v1/life/day-plans/2026-08-18')).statusCode).toBe(404)
  })

  it('persists a versioned day-plan draft update, creates server-owned item IDs, and rejects stale or foreign writes', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const day = await createDay(owner, '2026-08-24', [customItem('Original reminder')])
    const payload = {
      entityVersion: day.entityVersion,
      mealSlots: [{ id: 'brunch', name: 'Brunch', position: 0, hidden: false }],
      items: [
        {
          id: day.items[0]!.id, entityVersion: day.items[0]!.entityVersion,
          ...customItem('Edited reminder', 'brunch'), scheduledTime: '09:15',
        },
        { ...customItem('New reminder', 'brunch'), scheduledTime: '12:00' },
      ],
    }

    const updatedResponse = await owner.write({
      method: 'PATCH', url: '/api/v1/life/day-plans/2026-08-24', payload,
    })
    expect(updatedResponse.statusCode).toBe(200)
    const updated = updatedResponse.json<DayPlan>()
    expect(updated).toMatchObject({ entityVersion: day.entityVersion + 1, mealSlots: [{ id: 'brunch', name: 'Brunch' }] })
    expect(updated.items).toEqual([
      expect.objectContaining({ id: day.items[0]!.id, title: 'Edited reminder', entityVersion: day.items[0]!.entityVersion + 1 }),
      expect.objectContaining({ title: 'New reminder', entityVersion: 1 }),
    ])
    expect(updated.items[1]!.id).not.toBe(day.items[0]!.id)
    expect((await owner.get('/api/v1/life/day-plans/2026-08-24')).json()).toEqual(updated)

    const stale = await owner.write({ method: 'PATCH', url: '/api/v1/life/day-plans/2026-08-24', payload })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    expect((await other.write({ method: 'PATCH', url: '/api/v1/life/day-plans/2026-08-24', payload })).statusCode).toBe(404)

    const completionResponse = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: updated.date, dayPlanItemId: updated.items[0]!.id, completedAt: '2026-08-24T09:30:00.000Z' },
    }, 'complete-updated-draft')
    expect(completionResponse.statusCode).toBe(201)
    const completedPlan = (await owner.get('/api/v1/life/day-plans/2026-08-24')).json<DayPlan>()
    const immutableAttempt = await owner.write({
      method: 'PATCH', url: '/api/v1/life/day-plans/2026-08-24',
      payload: {
        entityVersion: completedPlan.entityVersion,
        mealSlots: completedPlan.mealSlots,
        items: completedPlan.items.map((item, index) => ({
          id: item.id, entityVersion: item.entityVersion, kind: item.kind,
          title: index === 0 ? 'Changed completed history' : item.title,
          mealSlotId: item.mealSlotId, scheduledTime: item.scheduledTime, source: item.source,
          quantity: item.quantity, unit: item.unit, servings: item.servings, durationMinutes: item.durationMinutes,
        })),
      },
    })
    expect(immutableAttempt.statusCode).toBe(409)
    expect(immutableAttempt.json()).toMatchObject({ error: { code: 'COMPLETED_ITEM_IMMUTABLE' } })
  })

  it('previews merge/replace/skip conflicts without writes, preserves custom meal slots, and keeps applied dates independent', async () => {
    const owner = await client()
    const template = await createTemplate(owner)
    await createDay(owner, '2026-08-18', [customItem('Existing breakfast', 'breakfast')])

    const preview = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/2026-08-18/template-preview',
      payload: { templateId: template.id, resolution: 'merge' },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      writesApplied: false,
      conflicts: [expect.objectContaining({ resolution: 'merge' })],
      result: { mealSlots: expect.arrayContaining([expect.objectContaining({ id: 'brunch', name: 'Brunch' })]) },
    })
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).json()).toMatchObject({
      items: [expect.objectContaining({ title: 'Existing breakfast' })],
    })

    const merged = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/2026-08-18/apply-template',
      payload: { templateId: template.id, resolution: 'merge', entityVersion: 1, templateVersion: 1 },
    }, 'apply-template-merge')
    expect(merged.statusCode).toBe(200)
    expect(merged.json<{ items: Array<{ title: string }> }>().items.map((entry) => entry.title)).toEqual(['Existing breakfast', 'Template breakfast'])

    for (const [date, resolution, expected] of [
      ['2026-08-19', 'skip', ['Existing breakfast']],
      ['2026-08-20', 'replace', ['Template breakfast']],
    ] as const) {
      await createDay(owner, date, [customItem('Existing breakfast', 'breakfast')])
      const applied = await owner.write({
        method: 'POST', url: `/api/v1/life/day-plans/${date}/apply-template`,
        payload: { templateId: template.id, resolution, entityVersion: 1, templateVersion: 1 },
      }, `apply-${resolution}`)
      expect(applied.statusCode).toBe(200)
      expect(applied.json<{ items: Array<{ title: string }> }>().items.map((entry) => entry.title)).toEqual(expected)
    }

    const updated = await owner.write({
      method: 'PATCH', url: `/api/v1/life/templates/${template.id}`,
      payload: {
        entityVersion: 1,
        name: 'Changed template',
        mealSlots: [{ id: 'breakfast', name: 'Breakfast', position: 0, hidden: false }],
        items: [{ ...customItem('Changed template item', 'breakfast'), weekdays: [1, 2, 3, 4, 5] }],
      },
    })
    expect(updated.statusCode).toBe(200)
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).json<{ items: Array<{ title: string }> }>().items.map((entry) => entry.title)).toEqual(['Existing breakfast', 'Template breakfast'])
  })

  it('rejects template application when the template changed after preview', async () => {
    const owner = await client()
    const template = await createTemplate(owner, 'Previewed template')
    await createDay(owner, '2026-08-18', [customItem('Existing breakfast', 'breakfast')])
    const previewResponse = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/2026-08-18/template-preview',
      payload: { templateId: template.id, resolution: 'replace' },
    })
    expect(previewResponse.statusCode).toBe(200)
    const preview = previewResponse.json<{ templateVersion: number; dayPlanVersion: number }>()
    expect(preview).toMatchObject({ templateVersion: 1, dayPlanVersion: 1 })
    const updated = await owner.write({
      method: 'PATCH', url: `/api/v1/life/templates/${template.id}`,
      payload: {
        entityVersion: 1, name: 'Changed after preview',
        mealSlots: [{ id: 'breakfast', name: 'Breakfast', position: 0, hidden: false }],
        items: [{ ...customItem('Changed item', 'breakfast'), weekdays: [1, 2, 3, 4, 5] }],
      },
    })
    expect(updated.statusCode).toBe(200)
    const applied = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/2026-08-18/apply-template',
      payload: { templateId: template.id, resolution: 'replace', entityVersion: preview.dayPlanVersion, templateVersion: preview.templateVersion },
    }, 'apply-stale-template-preview')
    expect(applied.statusCode).toBe(409)
    expect(applied.json()).toMatchObject({ error: { code: 'TEMPLATE_VERSION_CONFLICT' } })
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).json()).toMatchObject({
      entityVersion: 1, items: [expect.objectContaining({ title: 'Existing breakfast' })],
    })
  })

  it('rejects template sync when an affected day changed after preview', async () => {
    const owner = await client()
    const template = await createTemplate(owner, 'Sync v1')
    await createDay(owner, '2026-08-19', [])
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/2026-08-19/apply-template',
      payload: { templateId: template.id, resolution: 'merge', entityVersion: 1, templateVersion: 1 },
    }, 'apply-before-stale-sync')).statusCode).toBe(200)
    expect((await owner.write({
      method: 'PATCH', url: `/api/v1/life/templates/${template.id}`,
      payload: {
        entityVersion: 1, name: 'Sync v2',
        mealSlots: [{ id: 'breakfast', name: 'Breakfast', position: 0, hidden: false }],
        items: [{ ...customItem('Sync v2', 'breakfast'), weekdays: [1, 2, 3, 4, 5] }],
      },
    })).statusCode).toBe(200)
    const previewResponse = await owner.write({
      method: 'POST', url: `/api/v1/life/templates/${template.id}/sync-preview`,
      payload: { fromDate: '2026-08-19', target: 'future-incomplete' },
    })
    expect(previewResponse.statusCode).toBe(200)
    const preview = previewResponse.json<{ templateVersion: number; dayPlanVersions: Record<string, number> }>()
    expect(preview).toMatchObject({ templateVersion: 2, dayPlanVersions: { '2026-08-19': 2 } })
    const day = (await owner.get('/api/v1/life/day-plans/2026-08-19')).json<{ items: Array<{ id: string; entityVersion: number }> }>()
    expect((await owner.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/2026-08-19/items/${day.items[0]!.id}`,
      payload: { entityVersion: day.items[0]!.entityVersion, action: 'delay', at: '2026-08-19T08:30:00.000Z', delayedUntil: '09:00' },
    })).statusCode).toBe(200)
    const synced = await owner.write({
      method: 'POST', url: `/api/v1/life/templates/${template.id}/sync`,
      payload: { fromDate: '2026-08-19', target: 'future-incomplete', templateVersion: preview.templateVersion, dayPlanVersions: preview.dayPlanVersions },
    }, 'stale-day-sync')
    expect(synced.statusCode).toBe(409)
    expect(synced.json()).toMatchObject({ error: { code: 'DAY_PLAN_VERSION_CONFLICT' } })
  })

  it('allows only one concurrent template confirmation for the same preview versions', async () => {
    const owner = await client()
    const template = await createTemplate(owner, 'Concurrent template')
    await createDay(owner, '2026-08-24', [customItem('Concurrent existing', 'breakfast')])
    const input = {
      method: 'POST' as const, url: '/api/v1/life/day-plans/2026-08-24/apply-template',
      payload: { templateId: template.id, resolution: 'merge', entityVersion: 1, templateVersion: 1 },
    }
    const results = await Promise.all([
      owner.write(input, 'concurrent-apply-a'),
      owner.write(input, 'concurrent-apply-b'),
    ])
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409])
    expect(results.find((response) => response.statusCode === 409)?.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
  })

  it('copies only plans and performs explicit future sync without changing completed history', async () => {
    const owner = await client()
    const template = await createTemplate(owner, 'Template v1')
    for (const date of ['2026-08-18', '2026-08-19']) {
      await createDay(owner, date, [])
      const applied = await owner.write({
        method: 'POST', url: `/api/v1/life/day-plans/${date}/apply-template`,
        payload: { templateId: template.id, resolution: 'merge', entityVersion: 1, templateVersion: 1 },
      }, `initial-apply-${date}`)
      expect(applied.statusCode).toBe(200)
    }
    const first = (await owner.get('/api/v1/life/day-plans/2026-08-18')).json<{ items: Array<{ id: string }> }>()
    const completed = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: '2026-08-18', dayPlanItemId: first.items[0]!.id, completedAt: '2026-08-18T08:30:00.000Z' },
    }, 'complete-custom-history')
    expect(completed.statusCode).toBe(201)

    const copied = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/2026-08-18/copy', payload: { targetDate: '2026-08-20' },
    }, 'copy-date-plan')
    expect(copied.statusCode).toBe(201)
    expect(copied.json()).toMatchObject({
      date: '2026-08-20',
      items: [expect.objectContaining({ status: 'planned', completionId: null, actual: null })],
    })

    const updated = await owner.write({
      method: 'PATCH', url: `/api/v1/life/templates/${template.id}`,
      payload: {
        entityVersion: 1, name: 'Weekday rhythm v2',
        mealSlots: [{ id: 'breakfast', name: 'Breakfast', position: 0, hidden: false }],
        items: [{ ...customItem('Template v2', 'breakfast'), weekdays: [1, 2, 3, 4, 5] }],
      },
    })
    expect(updated.statusCode).toBe(200)
    const preview = await owner.write({
      method: 'POST', url: `/api/v1/life/templates/${template.id}/sync-preview`,
      payload: { fromDate: '2026-08-18', target: 'future-incomplete' },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ writesApplied: false, excludedCompletedDates: ['2026-08-18'] })
    const syncVersions = preview.json<{ templateVersion: number; dayPlanVersions: Record<string, number> }>()
    const sync = await owner.write({
      method: 'POST', url: `/api/v1/life/templates/${template.id}/sync`,
      payload: { fromDate: '2026-08-18', target: 'future-incomplete', templateVersion: syncVersions.templateVersion, dayPlanVersions: syncVersions.dayPlanVersions },
    }, 'sync-future-incomplete')
    expect(sync.statusCode).toBe(200)
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).json()).toMatchObject({ items: [expect.objectContaining({ title: 'Template v1', status: 'completed' })] })
    expect((await owner.get('/api/v1/life/day-plans/2026-08-19')).json()).toMatchObject({ items: [expect.objectContaining({ title: 'Template v2', status: 'planned' })] })
  })

  it('resolves a meal-linked supplement time and expands factual medicine recurrence without advice', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const supplement = await createCatalogItem(owner, 'supplement', 'User supplement', 'capsule')
    const medicine = await createCatalogItem(owner, 'medicine', 'User medicine', 'tablet')
    const day = await createDay(owner, '2026-08-17', [
      { ...customItem('Breakfast', 'breakfast'), kind: 'meal', scheduledTime: '08:00' },
      {
        kind: 'supplement', title: 'User supplement', mealSlotId: null, scheduledTime: null,
        relativeToItemIndex: 0, offsetMinutes: 30,
        source: { type: 'catalog-item', id: supplement.id }, quantity: 1, unit: 'capsule', servings: null, durationMinutes: null,
      },
    ])
    expect(day.items[1]).toMatchObject({ scheduledTime: '08:30' })

    const recurrence = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/recurrence-preview',
      payload: {
        kind: 'medicine', source: { type: 'catalog-item', id: medicine.id },
        recurrence: { mode: 'weekdays', weekdays: [1, 3], times: ['08:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
      },
    })
    expect(recurrence.statusCode).toBe(200)
    expect(recurrence.json()).toEqual({
      writesApplied: false,
      occurrences: [
        { date: '2026-08-17', time: '08:00', factual: true },
        { date: '2026-08-19', time: '08:00', factual: true },
      ],
    })
    expect(JSON.stringify(recurrence.json())).not.toMatch(/recommendation|dosageAdvice|interactionAdvice/i)

    const ruleInput = {
      title: 'User-authored medicine schedule', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'weekdays' as const, weekdays: [1, 3], times: ['08:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
    }
    const createRule = () => owner.write({ method: 'POST', url: '/api/v1/life/day-plans/recurrence-rules', payload: ruleInput }, 'create-medicine-recurrence')
    const created = await createRule()
    expect(created.statusCode).toBe(201)
    expect(await createRule().then((response) => response.json())).toEqual(created.json())
    const rule = created.json<{ id: string; entityVersion: number }>()
    expect(rule).toMatchObject({ entityVersion: 1, deletedAt: null, ...ruleInput })
    expect((await owner.get('/api/v1/life/day-plans/recurrence-rules')).json()).toEqual([expect.objectContaining({ id: rule.id })])
    expect((await other.get('/api/v1/life/day-plans/recurrence-rules')).json()).toEqual([])
    expect((await other.write({
      method: 'POST', url: '/api/v1/life/day-plans/recurrence-rules', payload: ruleInput,
    }, 'foreign-medicine-recurrence')).statusCode).toBe(404)
    expect((await other.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...ruleInput, entityVersion: 1 },
    })).statusCode).toBe(404)
    const updatedRule = await owner.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...ruleInput, entityVersion: 1, recurrence: { mode: 'interval', everyDays: 2, times: ['09:00'], startDate: '2026-08-17', endDate: '2026-08-23' } },
    })
    expect(updatedRule.statusCode).toBe(200)
    expect(updatedRule.json()).toMatchObject({ entityVersion: 2, recurrence: { mode: 'interval', everyDays: 2, times: ['09:00'] } })
    const stalePatch = await owner.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...ruleInput, entityVersion: 1 },
    })
    expect(stalePatch.statusCode).toBe(409)
    expect(stalePatch.json()).toMatchObject({
      error: { code: 'VERSION_CONFLICT', current: expect.objectContaining({ id: rule.id, entityVersion: 2 }) },
    })
    const staleDelete = await owner.write({
      method: 'DELETE', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`, payload: { entityVersion: 1 },
    })
    expect(staleDelete.statusCode).toBe(409)
    expect(staleDelete.json()).toMatchObject({
      error: { code: 'VERSION_CONFLICT', current: expect.objectContaining({ id: rule.id, entityVersion: 2 }) },
    })
    expect((await owner.write({
      method: 'DELETE', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`, payload: { entityVersion: 2 },
    })).statusCode).toBe(204)
    expect((await owner.get('/api/v1/life/day-plans/recurrence-rules')).json()).toEqual([])
  })

  it('allows only one concurrent recurrence update for a shared entity version', async () => {
    const owner = await client()
    const medicine = await createCatalogItem(owner, 'medicine', 'Concurrent medicine', 'tablet')
    const input = {
      title: 'Concurrent medicine schedule', sourceId: medicine.id, quantity: 1, unit: 'tablet',
      recurrence: { mode: 'interval' as const, everyDays: 1, times: ['08:00'], startDate: '2026-08-17', endDate: '2026-08-23' },
    }
    const created = await owner.write({ method: 'POST', url: '/api/v1/life/day-plans/recurrence-rules', payload: input }, 'concurrent-recurrence')
    const rule = created.json<{ id: string }>()
    const update = (time: string) => owner.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...input, entityVersion: 1, recurrence: { ...input.recurrence, times: [time] } },
    })
    const results = await Promise.all([update('09:00'), update('10:00')])
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409])
    expect(results.find((response) => response.statusCode === 409)?.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
  })

  it('accepts exactly 366 inclusive days and rejects 367', async () => {
    const owner = await client()
    const medicine = await createCatalogItem(owner, 'medicine', 'Range-bound medicine', 'tablet')
    const accepted = await owner.write({
      method: 'POST',
      url: '/api/v1/life/day-plans/recurrence-rules',
      payload: medicineRuleInput(medicine.id, {
        title: 'Exactly 366 inclusive days',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
      }),
    }, 'accept-366-inclusive-days')
    expect(accepted.statusCode).toBe(201)

    const rejected = await owner.write({
      method: 'POST',
      url: '/api/v1/life/day-plans/recurrence-rules',
      payload: medicineRuleInput(medicine.id, {
        title: 'Exactly 367 inclusive days',
        startDate: '2026-01-01',
        endDate: '2027-01-02',
      }),
    }, 'reject-367-inclusive-days')
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).toMatchObject({ error: { code: 'RECURRENCE_RANGE_TOO_LARGE' } })
    expect((await owner.get('/api/v1/life/day-plans/recurrence-rules')).json()).toHaveLength(1)
  })

  it('accepts exactly 10,000 persisted occurrences and rejects 10,001', async () => {
    const owner = await client()
    const medicine = await createCatalogItem(owner, 'medicine', 'Occurrence-bound medicine', 'tablet')
    const accepted = await owner.write({
      method: 'POST',
      url: '/api/v1/life/day-plans/recurrence-rules',
      payload: medicineRuleInput(medicine.id, {
        title: 'Exactly 10000 persisted occurrences',
        times: medicineTimes(100),
        startDate: '2026-01-01',
        endDate: '2026-04-10',
      }),
    }, 'accept-exactly-10000-occurrences')
    expect(accepted.statusCode).toBe(201)

    const rejected = await owner.write({
      method: 'POST',
      url: '/api/v1/life/day-plans/recurrence-rules',
      payload: medicineRuleInput(medicine.id, {
        title: 'Exactly 10001 persisted occurrences',
        times: medicineTimes(137),
        startDate: '2026-01-01',
        endDate: '2026-03-14',
      }),
    }, 'reject-exactly-10001-occurrences')
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).toMatchObject({ error: { code: 'RECURRENCE_OCCURRENCE_LIMIT' } })
    expect((await owner.get('/api/v1/life/day-plans/recurrence-rules')).json()).toHaveLength(1)
  })

  it('merges stable owner-scoped occurrences into calendar and date timelines without eager day-plan writes', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const medicine = await createCatalogItem(owner, 'medicine', 'Timeline medicine', 'tablet')
    const explicitDay = await createDay(owner, '2026-08-17', [customItem('Persisted breakfast', 'breakfast')])
    const explicitBefore = (await owner.get('/api/v1/life/day-plans/2026-08-17')).json()
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).statusCode).toBe(404)

    const { rule } = await createMedicineRule(owner, medicine.id, {
      title: 'Timeline medicine facts',
      startDate: '2026-08-17',
      endDate: '2026-08-19',
    }, 'timeline-occurrence-rule')

    const explicitAfter = (await owner.get('/api/v1/life/day-plans/2026-08-17')).json()
    expect(explicitAfter).toEqual(explicitBefore)
    expect(explicitAfter).toMatchObject({ id: explicitDay.id, entityVersion: explicitDay.entityVersion })

    const firstTimeline = await readTimeline(owner, '2026-08-17')
    expect(firstTimeline.response.statusCode).toBe(200)
    expect(firstTimeline.body).toMatchObject({ date: '2026-08-17' })
    expect(firstTimeline.body.timelineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'day-plan-item', id: explicitDay.items[0]!.id }),
      expect.objectContaining({
        sourceType: 'medicine-occurrence', ruleId: rule.id, kind: 'medicine', title: 'Timeline medicine facts',
        source: { type: 'catalog-item', id: medicine.id }, quantity: 1, unit: 'tablet',
        originalDate: '2026-08-17', originalTime: '08:00', scheduledDate: '2026-08-17', scheduledTime: '08:00',
        status: 'planned', completionId: null, entityVersion: 1,
      }),
    ]))
    const firstIdentity = occurrenceAt(firstTimeline.body, '08:00')
    const repeatedIdentity = occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')
    expect(repeatedIdentity.id).toBe(firstIdentity.id)

    const occurrenceOnly = await readTimeline(owner, '2026-08-18')
    expect(occurrenceOnly.response.statusCode).toBe(200)
    expect(occurrenceOnly.body.timelineItems).toEqual([
      expect.objectContaining({
        sourceType: 'medicine-occurrence', ruleId: rule.id,
        originalDate: '2026-08-18', originalTime: '08:00', status: 'planned',
      }),
    ])
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).statusCode).toBe(404)

    const calendar = await owner.get('/api/v1/life/calendar?from=2026-08-17&to=2026-08-19&today=2026-08-13')
    expect(calendar.statusCode).toBe(200)
    expect(calendar.json()).toEqual([
      { date: '2026-08-17', state: 'planned', itemCount: 2, completedCount: 0 },
      { date: '2026-08-18', state: 'planned', itemCount: 1, completedCount: 0 },
      { date: '2026-08-19', state: 'planned', itemCount: 1, completedCount: 0 },
    ])
    const otherTimeline = await readTimeline(other, '2026-08-18')
    expect(otherTimeline.response.statusCode).toBe(200)
    expect(otherTimeline.body).toEqual({ date: '2026-08-18', timelineItems: [] })
  })

  it('moves a delayed occurrence without changing its identity and protects versioned owner-scoped terminal transitions', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const medicine = await createCatalogItem(owner, 'medicine', 'Transition medicine', 'tablet')
    const { input, rule } = await createMedicineRule(owner, medicine.id, {
      title: 'Transition occurrence facts', startDate: '2026-08-17', endDate: '2026-08-17',
    }, 'transition-occurrence-rule')
    const original = occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')

    const delayed = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: {
        entityVersion: original.entityVersion,
        action: 'delay',
        at: '2026-08-16T09:00:00.000Z',
        delayedUntil: { date: '2026-08-18', time: '10:30' },
      },
    }, 'delay-transition-occurrence')
    expect(delayed.statusCode).toBe(200)
    expect(delayed.json()).toMatchObject({
      id: original.id,
      ruleId: rule.id,
      entityVersion: 2,
      originalDate: '2026-08-17',
      originalTime: '08:00',
      scheduledDate: '2026-08-18',
      scheduledTime: '10:30',
      status: 'planned',
    })
    expect((await readTimeline(owner, '2026-08-17')).body.timelineItems).toEqual([])
    expect((await readTimeline(owner, '2026-08-18')).body.timelineItems).toEqual([
      expect.objectContaining({ id: original.id, scheduledDate: '2026-08-18', scheduledTime: '10:30' }),
    ])
    expect((await owner.get('/api/v1/life/calendar?from=2026-08-17&to=2026-08-18&today=2026-08-13')).json()).toEqual([
      { date: '2026-08-18', state: 'planned', itemCount: 1, completedCount: 0 },
    ])

    const reconciled = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...input, entityVersion: rule.entityVersion, title: 'Renamed transition facts' },
    })
    expect(reconciled.statusCode).toBe(200)
    const retained = (await readTimeline(owner, '2026-08-18')).body.timelineItems[0] as MedicineOccurrenceTimelineItem
    expect(retained).toMatchObject({
      id: original.id,
      entityVersion: 3,
      title: 'Renamed transition facts',
      originalDate: '2026-08-17',
      originalTime: '08:00',
      scheduledDate: '2026-08-18',
      scheduledTime: '10:30',
      status: 'planned',
    })

    const foreign = await other.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: { entityVersion: retained.entityVersion, action: 'skip', at: '2026-08-16T10:00:00.000Z' },
    }, 'foreign-transition-occurrence')
    expect(foreign.statusCode).toBe(404)
    const stale = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: { entityVersion: original.entityVersion, action: 'skip', at: '2026-08-16T10:00:00.000Z' },
    }, 'stale-transition-occurrence')
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({
      error: { code: 'VERSION_CONFLICT', current: expect.objectContaining({ id: original.id, entityVersion: 3 }) },
    })

    const skipWithDelayFields = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: {
        entityVersion: retained.entityVersion,
        action: 'skip',
        at: '2026-08-16T10:00:00.000Z',
        delayedUntil: { date: '2026-08-19', time: '11:00' },
      },
    }, 'reject-delay-fields-on-skip')
    expect(skipWithDelayFields.statusCode).toBe(400)
    expect(skipWithDelayFields.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })

    const skipped = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: { entityVersion: retained.entityVersion, action: 'skip', at: '2026-08-16T10:00:00.000Z' },
    }, 'skip-transition-occurrence')
    expect((await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: { entityVersion: retained.entityVersion, action: 'skip', at: '2026-08-16T10:00:00.000Z' },
    }, 'skip-transition-occurrence')).json()).toEqual(skipped.json())
    expect(skipped.statusCode).toBe(200)
    expect(skipped.json()).toMatchObject({ id: original.id, entityVersion: 4, status: 'skipped' })
    expect((await readTimeline(owner, '2026-08-18')).body.timelineItems).toEqual([
      expect.objectContaining({ id: original.id, status: 'skipped', scheduledDate: '2026-08-18', scheduledTime: '10:30' }),
    ])
    const terminal = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: {
        entityVersion: 4,
        action: 'delay',
        at: '2026-08-16T11:00:00.000Z',
        delayedUntil: { date: '2026-08-19', time: '11:00' },
      },
    }, 'terminal-transition-occurrence')
    expect(terminal.statusCode).toBe(409)
    expect(terminal.json()).toMatchObject({
      error: { code: 'OCCURRENCE_NOT_TRANSITIONABLE', current: expect.objectContaining({ id: original.id, entityVersion: 4, status: 'skipped' }) },
    })
    const completeSkipped = await owner.write({
      method: 'POST',
      url: '/api/v1/life/completions',
      payload: {
        medicineOccurrenceId: original.id,
        medicineOccurrenceVersion: 4,
        completedAt: '2026-08-18T10:35:00.000Z',
      },
    }, 'complete-terminal-occurrence')
    expect(completeSkipped.statusCode).toBe(409)
    expect(completeSkipped.json()).toMatchObject({
      error: { code: 'OCCURRENCE_NOT_COMPLETABLE', current: expect.objectContaining({ id: original.id, entityVersion: 4, status: 'skipped' }) },
    })
  })

  it('keeps occurrence transition timestamps monotonic when the submitted event time predates persisted history', async () => {
    const owner = await client()
    const medicine = await createCatalogItem(owner, 'medicine', 'Monotonic transition medicine', 'tablet')
    await createMedicineRule(owner, medicine.id, {
      title: 'Monotonic occurrence facts', startDate: '2026-08-17', endDate: '2026-08-17',
    }, 'monotonic-transition-rule')
    const original = occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')

    const response = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/medicine-occurrences/${original.id}`,
      payload: {
        entityVersion: original.entityVersion,
        action: 'delay',
        at: '2026-08-12T09:00:00.000Z',
        delayedUntil: { date: '2026-08-18', time: '10:30' },
      },
    }, 'backdated-transition-occurrence')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: original.id,
      entityVersion: 2,
      updatedAt: original.updatedAt,
      scheduledDate: '2026-08-18',
      scheduledTime: '10:30',
    })
  })

  it('completes exactly one occurrence source with owner version and idempotency safety', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const medicine = await createCatalogItem(owner, 'medicine', 'Completion medicine', 'tablet')
    await stockMedicine(owner, medicine.id, 'stock-completion-medicine')
    const { rule } = await createMedicineRule(owner, medicine.id, {
      title: 'Completion occurrence facts', times: ['08:00', '09:00'], startDate: '2026-08-17', endDate: '2026-08-17',
    }, 'completion-occurrence-rule')
    const timeline = await readTimeline(owner, '2026-08-17')
    expect(timeline.response.statusCode).toBe(200)
    const eight = occurrenceAt(timeline.body, '08:00')
    const nine = occurrenceAt(timeline.body, '09:00')
    const completionPayload = {
      medicineOccurrenceId: eight.id,
      medicineOccurrenceVersion: eight.entityVersion,
      completedAt: '2026-08-17T08:05:00.000Z',
    }
    const complete = (subject: Client, key: string) => subject.write({
      method: 'POST', url: '/api/v1/life/completions', payload: completionPayload,
    }, key)

    const first = await complete(owner, 'complete-occurrence-idempotently')
    const replay = await complete(owner, 'complete-occurrence-idempotently')
    expect(first.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({
      kind: 'medicine',
      source: { type: 'catalog-item', id: medicine.id },
      quantity: 1,
      unit: 'tablet',
      completionSource: {
        type: 'medicine-occurrence', id: eight.id, ruleId: rule.id,
        originalDate: '2026-08-17', originalTime: '08:00',
      },
    })
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${medicine.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: medicine.id, onHand: 9 }),
    ])

    const foreign = await complete(other, 'foreign-occurrence-completion')
    expect(foreign.statusCode).toBe(404)
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${medicine.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: medicine.id, onHand: 9 }),
    ])

    const stale = await complete(owner, 'stale-occurrence-completion')
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT', current: expect.objectContaining({ id: eight.id }) } })

    const day = await createDay(owner, '2026-08-17', [customItem('Exactly one source')])
    const dualSource = await owner.write({
      method: 'POST',
      url: '/api/v1/life/completions',
      payload: {
        date: day.date,
        dayPlanItemId: day.items[0]!.id,
        medicineOccurrenceId: nine.id,
        medicineOccurrenceVersion: nine.entityVersion,
        completedAt: '2026-08-17T09:05:00.000Z',
      },
    }, 'reject-dual-completion-source')
    expect(dualSource.statusCode).toBe(400)
    expect(dualSource.json()).toMatchObject({ error: { code: 'INVALID_COMPLETION_SOURCE' } })
    const missingOccurrenceVersion = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { medicineOccurrenceId: nine.id, completedAt: '2026-08-17T09:05:00.000Z' },
    }, 'reject-missing-occurrence-version')
    expect(missingOccurrenceVersion.statusCode).toBe(400)
    expect(missingOccurrenceVersion.json()).toMatchObject({ error: { code: 'INVALID_COMPLETION_SOURCE' } })

    const concurrentPayload = {
      medicineOccurrenceId: nine.id,
      medicineOccurrenceVersion: nine.entityVersion,
      completedAt: '2026-08-17T09:05:00.000Z',
    }
    const concurrent = await Promise.all([
      owner.write({ method: 'POST', url: '/api/v1/life/completions', payload: concurrentPayload }, 'complete-nine-a'),
      owner.write({ method: 'POST', url: '/api/v1/life/completions', payload: concurrentPayload }, 'complete-nine-b'),
    ])
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([201, 409])
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${medicine.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: medicine.id, onHand: 8 }),
    ])
  })

  it('freezes a costed medicine completion source and schedule while concurrent replay creates one consume effect', async () => {
    const owner = await client()
    const ownerUser = await store.findUserByAccount('owner@example.com')
    const medicine = await store.createCatalogItem(ownerUser!.id, {
      kind: 'medicine',
      name: 'Costed medicine facts',
      baseUnit: 'tablet',
      availableUnits: ['tablet'],
      pricePoints: [{ amountMinor: 1_000, currency: 'CNY', purchaseQuantity: 10, purchaseUnit: 'tablet', effectiveFrom: '2026-08-01' }],
    }, 'costed-completion-medicine')
    await store.createInventoryTransaction(ownerUser!.id, {
      itemId: medicine.id,
      kind: 'purchase',
      quantity: 10,
      unit: 'tablet',
      occurredAt: '2026-08-13T08:00:00.000Z',
      batch: { actualUnitCostMinor: 37 },
    }, 'stock-costed-completion-medicine')
    const input = { ...medicineRuleInput(medicine.id, {
      title: 'Costed completion schedule', startDate: '2026-08-17', endDate: '2026-08-17',
    }), quantity: 2 }
    const created = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans/recurrence-rules', payload: input,
    }, 'costed-completion-rule')
    expect(created.statusCode).toBe(201)
    const rule = created.json<{ id: string; entityVersion: number }>()
    const occurrence = occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')
    const complete = () => owner.write({
      method: 'POST',
      url: '/api/v1/life/completions',
      payload: {
        medicineOccurrenceId: occurrence.id,
        medicineOccurrenceVersion: occurrence.entityVersion,
        completedAt: '2026-08-17T08:05:00.000Z',
      },
    }, 'complete-costed-medicine-once')

    const concurrent = await Promise.all([complete(), complete()])
    expect(concurrent.map((response) => response.statusCode)).toEqual([201, 201])
    expect(concurrent[1]!.json()).toEqual(concurrent[0]!.json())
    const frozen = concurrent[0]!.json()
    expect(frozen).toMatchObject({
      kind: 'medicine',
      source: { type: 'catalog-item', id: medicine.id },
      quantity: 2,
      unit: 'tablet',
      costMinor: 74,
      completionSource: {
        type: 'medicine-occurrence',
        id: occurrence.id,
        ruleId: rule.id,
        originalDate: '2026-08-17',
        originalTime: '08:00',
        scheduledDate: '2026-08-17',
        scheduledTime: '08:00',
      },
    })

    await store.updateCatalogItem(ownerUser!.id, medicine.id, {
      version: medicine.version,
      name: 'Changed catalog medicine facts',
      pricePoints: [{ amountMinor: 9_999, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'tablet', effectiveFrom: '2026-08-01' }],
    })
    const updatedRule = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...input, entityVersion: rule.entityVersion, title: 'Changed rule facts', quantity: 3 },
    })
    expect(updatedRule.statusCode).toBe(200)
    expect((await complete()).json()).toEqual(frozen)
    const transactions = (await owner.get(`/api/v1/life/inventory/transactions?itemId=${medicine.id}`))
      .json<Array<{ kind: string; quantity: number; unit: string }>>()
    expect(transactions.filter((entry) => entry.kind === 'consume')).toEqual([
      expect.objectContaining({ quantity: 2, unit: 'tablet' }),
    ])
  })

  it('reconciles only future incomplete occurrences while freezing past and terminal evidence', async () => {
    const owner = await client()
    const medicine = await createCatalogItem(owner, 'medicine', 'History medicine', 'tablet')
    await stockMedicine(owner, medicine.id, 'stock-history-medicine')
    const { input, rule } = await createMedicineRule(owner, medicine.id, {
      title: 'History occurrence facts', startDate: '2026-08-12', endDate: '2026-08-18',
    }, 'history-occurrence-rule')
    const pastBefore = occurrenceAt((await readTimeline(owner, '2026-08-12')).body, '08:00')
    const completedBefore = occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')
    const futureBefore = occurrenceAt((await readTimeline(owner, '2026-08-18')).body, '08:00')
    const completed = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: {
        medicineOccurrenceId: completedBefore.id,
        medicineOccurrenceVersion: completedBefore.entityVersion,
        completedAt: '2026-08-17T08:05:00.000Z',
      },
    }, 'complete-history-occurrence')
    expect(completed.statusCode).toBe(201)

    const updated = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: {
        ...input,
        entityVersion: rule.entityVersion,
        recurrence: { mode: 'interval', everyDays: 1, times: ['09:00'], startDate: '2026-08-18', endDate: '2026-08-18' },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ entityVersion: 2 })

    const pastAfter = occurrenceAt((await readTimeline(owner, '2026-08-12')).body, '08:00')
    expect(pastAfter).toMatchObject({ id: pastBefore.id, entityVersion: pastBefore.entityVersion, status: 'planned' })
    const completedAfter = occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')
    expect(completedAfter).toMatchObject({ id: completedBefore.id, status: 'completed' })
    expect(completedAfter.completionId).toBe(completed.json<{ id: string }>().id)
    const futureAfter = await readTimeline(owner, '2026-08-18')
    expect(futureAfter.body.timelineItems).toEqual([
      expect.objectContaining({ sourceType: 'medicine-occurrence', originalTime: '09:00', status: 'planned', entityVersion: 1 }),
    ])
    expect(futureAfter.body.timelineItems).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: futureBefore.id }),
    ]))

    const readded = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: {
        ...input,
        entityVersion: 2,
        recurrence: { mode: 'interval', everyDays: 1, times: ['08:00', '09:00'], startDate: '2026-08-18', endDate: '2026-08-18' },
      },
    })
    expect(readded.statusCode).toBe(200)
    expect(readded.json()).toMatchObject({ entityVersion: 3 })
    const afterReaddingCancelledIdentity = await readTimeline(owner, '2026-08-18')
    expect(afterReaddingCancelledIdentity.body.timelineItems).toEqual([
      expect.objectContaining({ sourceType: 'medicine-occurrence', originalTime: '09:00', status: 'planned' }),
    ])

    const deleted = await owner.write({
      method: 'DELETE', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`, payload: { entityVersion: 3 },
    })
    expect(deleted.statusCode).toBe(204)
    const afterDelete = await readTimeline(owner, '2026-08-18')
    expect(afterDelete.body.timelineItems).toEqual([])
    expect(occurrenceAt((await readTimeline(owner, '2026-08-12')).body, '08:00')).toEqual(pastAfter)
    expect(occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')).toEqual(completedAfter)
  })

  it('undoes occurrence completion to planned only while the current active rule still includes it', async () => {
    const owner = await client()
    const medicine = await createCatalogItem(owner, 'medicine', 'Undo medicine', 'tablet')
    await stockMedicine(owner, medicine.id, 'stock-undo-medicine')
    const { input, rule } = await createMedicineRule(owner, medicine.id, {
      title: 'Undo occurrence facts', times: ['08:00', '09:00'], startDate: '2026-08-17', endDate: '2026-08-17',
    }, 'undo-occurrence-rule')
    const initial = await readTimeline(owner, '2026-08-17')
    const eight = occurrenceAt(initial.body, '08:00')
    const nine = occurrenceAt(initial.body, '09:00')

    const completeOccurrence = (occurrence: MedicineOccurrenceTimelineItem, key: string) => owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: {
        medicineOccurrenceId: occurrence.id,
        medicineOccurrenceVersion: occurrence.entityVersion,
        completedAt: `2026-08-17T${occurrence.originalTime}:05.000Z`,
      },
    }, key)
    const completedEight = await completeOccurrence(eight, 'complete-undo-eight')
    expect(completedEight.statusCode).toBe(201)
    const undoEight = await owner.write({
      method: 'POST', url: `/api/v1/life/completions/${completedEight.json<{ id: string }>().id ?? 'missing-completion'}/undo`, payload: {},
    }, 'undo-included-eight')
    expect(undoEight.statusCode).toBe(200)
    expect(undoEight.json()).toMatchObject({ status: 'planned' })
    expect(occurrenceAt((await readTimeline(owner, '2026-08-17')).body, '08:00')).toMatchObject({ id: eight.id, status: 'planned' })

    const completedNine = await completeOccurrence(nine, 'complete-undo-nine')
    expect(completedNine.statusCode).toBe(201)
    const updated = await owner.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/recurrence-rules/${rule.id}`,
      payload: { ...input, entityVersion: rule.entityVersion, recurrence: { ...input.recurrence, times: ['08:00'] } },
    })
    expect(updated.statusCode).toBe(200)
    const undoNine = await owner.write({
      method: 'POST', url: `/api/v1/life/completions/${completedNine.json<{ id: string }>().id ?? 'missing-completion'}/undo`, payload: {},
    }, 'undo-removed-nine')
    expect(undoNine.statusCode).toBe(200)
    expect(undoNine.json()).toMatchObject({ status: 'cancelled' })
    expect((await readTimeline(owner, '2026-08-17')).body.timelineItems).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: nine.id }),
    ]))
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${medicine.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: medicine.id, onHand: 10 }),
    ])
  })

  it('recalculates future projections from current facts while reading completed snapshots and prepared food', async () => {
    const owner = await client()
    const ownerUser = await store.findUserByAccount('owner@example.com')
    const supplement = await store.createCatalogItem(ownerUser!.id, {
      kind: 'supplement', name: 'Projected supplement', baseUnit: 'capsule', availableUnits: ['capsule'],
      nutrition: { basisQuantity: 1, basisUnit: 'capsule', values: { energyKcal: 5, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 0 } },
      pricePoints: [{ amountMinor: 3_000, currency: 'CNY', purchaseQuantity: 30, purchaseUnit: 'capsule', effectiveFrom: '2026-08-01' }],
    }, 'projection-supplement')
    await store.createInventoryTransaction(ownerUser!.id, {
      itemId: supplement.id, kind: 'purchase', quantity: 10, unit: 'capsule', occurredAt: '2026-08-18T06:00:00.000Z',
      batch: { actualUnitCostMinor: 73 },
    }, 'projection-supplement-stock')
    const supplementDay = await createDay(owner, '2026-08-20', [{
      kind: 'supplement', title: 'Projected supplement', mealSlotId: null, scheduledTime: '08:00',
      source: { type: 'catalog-item', id: supplement.id }, quantity: 2, unit: 'capsule', servings: null, durationMinutes: null,
    }])
    const plannedProjection = await owner.get('/api/v1/life/day-plans/2026-08-20/projection')
    expect(plannedProjection.statusCode).toBe(200)
    expect(plannedProjection.json()).toMatchObject({
      date: '2026-08-20', status: 'complete', plannedNutrition: { energyKcal: 10, proteinGrams: 2, fatGrams: 0, carbohydrateGrams: 0 },
      actualNutrition: {}, plannedCostMinor: 200, actualCostMinor: 0, sourceIds: [supplement.id],
      inventory: [expect.objectContaining({ itemId: supplement.id, status: 'complete', onHand: 10, plannedDemand: 2, projectedBalance: 8, shortage: 0 })],
      items: [expect.objectContaining({ dayPlanItemId: supplementDay.items[0]!.id, mode: 'planned', status: 'complete', costMinor: 200 })],
    })
    const completed = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: supplementDay.date, dayPlanItemId: supplementDay.items[0]!.id, completedAt: '2026-08-20T08:05:00.000Z' },
    }, 'projection-complete-supplement')
    expect(completed.statusCode).toBe(201)
    await store.updateCatalogItem(ownerUser!.id, supplement.id, {
      version: supplement.version,
      nutrition: { basisQuantity: 1, basisUnit: 'capsule', values: { energyKcal: 50, proteinGrams: 10, fatGrams: 0, carbohydrateGrams: 0 } },
      pricePoints: [{ amountMinor: 6_000, currency: 'CNY', purchaseQuantity: 30, purchaseUnit: 'capsule', effectiveFrom: '2026-08-01' }],
    })
    const completedProjection = await owner.get('/api/v1/life/day-plans/2026-08-20/projection')
    expect(completedProjection.statusCode).toBe(200)
    expect(completedProjection.json()).toMatchObject({
      plannedNutrition: {}, actualNutrition: { energyKcal: 10, proteinGrams: 2, fatGrams: 0, carbohydrateGrams: 0 },
      plannedCostMinor: 0, actualCostMinor: 146, inventory: [],
      items: [expect.objectContaining({ mode: 'actual', nutrition: expect.objectContaining({ energyKcal: 10 }), costMinor: 146 })],
    })

    const ingredient = await store.createCatalogItem(ownerUser!.id, {
      kind: 'ingredient', name: 'Prepared grain', baseUnit: 'gram',
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 100, proteinGrams: 4, fatGrams: 1, carbohydrateGrams: 20 } },
      pricePoints: [{ amountMinor: 100, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, 'projection-grain')
    await store.createInventoryTransaction(ownerUser!.id, {
      itemId: ingredient.id, kind: 'purchase', quantity: 1_000, unit: 'gram', occurredAt: '2026-08-18T06:00:00.000Z',
    }, 'projection-grain-stock')
    const recipe = await store.createRecipe(ownerUser!.id, {
      name: 'Prepared grain bowl', servings: 4,
      components: [{ itemId: ingredient.id, quantity: 400, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ instruction: 'Cook the grain.', ingredientItemIds: [ingredient.id], durationSeconds: 600, imageMediaId: null, caution: '', position: 0 }],
    }, 'projection-recipe')
    const cooking = await store.createCookingSession(ownerUser!.id, {
      recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 4,
    }, 'projection-cooking')
    await store.completeCookingSession(ownerUser!.id, cooking.id, {
      madeServings: 4, eatenServings: 0, completedAt: '2026-08-19T10:00:00.000Z',
    }, 'projection-cooking-complete')
    const mealDay = await createDay(owner, '2026-08-21', [{
      kind: 'meal', title: 'Prepared grain bowl', mealSlotId: 'breakfast', scheduledTime: '08:00',
      source: { type: 'recipe-version', id: recipe.id, versionId: null }, quantity: null, unit: null, servings: 2, durationMinutes: null,
    }])
    const mealProjection = await owner.get('/api/v1/life/day-plans/2026-08-21/projection')
    expect(mealProjection.statusCode).toBe(200)
    expect(mealProjection.json()).toMatchObject({
      status: 'complete', plannedNutrition: { energyKcal: 200, proteinGrams: 8, fatGrams: 2, carbohydrateGrams: 40 },
      plannedCostMinor: 200, inventory: [],
      items: [expect.objectContaining({
        dayPlanItemId: mealDay.items[0]!.id, mode: 'planned', status: 'complete',
        preparedFood: expect.objectContaining({ portionsAvailable: 4, portionsAllocated: 2, portionsRemainingAfterPlan: 2 }),
      })],
    })
    await store.updateCatalogItem(ownerUser!.id, ingredient.id, {
      version: ingredient.version,
      status: 'disabled',
    })
    const mealCompletion = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: mealDay.date, dayPlanItemId: mealDay.items[0]!.id, completedAt: '2026-08-21T08:05:00.000Z' },
    }, 'complete-prepared-meal')
    expect(mealCompletion.statusCode).toBe(201)
    expect(mealCompletion.json()).toMatchObject({
      kind: 'meal', nutrition: { energyKcal: 200, proteinGrams: 8, fatGrams: 2, carbohydrateGrams: 40 },
      costMinor: 200,
      preparedFoodEventIds: [expect.any(String)],
      inventoryTransactionIds: [],
      source: { type: 'recipe-version', id: recipe.id, versionId: recipe.currentVersion.id },
      quantity: null,
      unit: null,
      servings: 2,
      energyIsEstimate: false,
    })
    expect((await owner.get('/api/v1/life/day-plans/2026-08-21')).json()).toMatchObject({
      items: [expect.objectContaining({
        actual: expect.objectContaining({
          source: { type: 'recipe-version', id: recipe.id, versionId: recipe.currentVersion.id },
          quantity: null,
          unit: null,
          servings: 2,
          energyIsEstimate: false,
        }),
      })],
    })
    expect(await store.listPreparedFood(ownerUser!.id)).toEqual([
      expect.objectContaining({ portionsRemaining: 2, costRemainingMinor: 200 }),
    ])
    const mealUndo = await owner.write({
      method: 'POST', url: `/api/v1/life/completions/${mealCompletion.json<{ id: string }>().id}/undo`, payload: {},
    }, 'undo-prepared-meal')
    expect(mealUndo.statusCode).toBe(200)
    expect(mealUndo.json()).toMatchObject({ restoredPreparedFoodEventIds: [expect.any(String)] })
    expect(await store.listPreparedFood(ownerUser!.id)).toEqual([
      expect.objectContaining({ portionsRemaining: 4, costRemainingMinor: 400 }),
    ])
  })

  it('uses actual fitness minutes for an explicitly estimated completion snapshot', async () => {
    const owner = await client()
    const activity = await owner.write({
      method: 'POST', url: '/api/v1/life/fitness',
      payload: { name: 'User-authored cycle', defaultMinutes: 60, kcalPerHour: 600, intensity: 'moderate', steps: [], equipment: [] },
    }, 'fitness-cycle')
    expect(activity.statusCode).toBe(201)
    const fitnessId = activity.json<{ id: string }>().id
    const day = await createDay(owner, '2026-08-18', [{
      kind: 'fitness', title: 'Cycle', mealSlotId: null, scheduledTime: '18:00',
      source: { type: 'fitness-activity', id: fitnessId }, quantity: null, unit: null, servings: null, durationMinutes: 60,
    }])
    const complete = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: day.date, dayPlanItemId: day.items[0]!.id, completedAt: '2026-08-18T18:45:00.000Z', actualMinutes: 45 },
    }, 'complete-cycle')
    expect(complete.statusCode).toBe(201)
    expect(complete.json()).toMatchObject({
      kind: 'fitness', actualMinutes: 45, estimatedEnergyKcal: 450, energyIsEstimate: true,
    })
    expect((await owner.get('/api/v1/life/day-plans/2026-08-18')).json()).toMatchObject({
      items: [expect.objectContaining({
        actual: expect.objectContaining({ actualMinutes: 45, estimatedEnergyKcal: 450, energyIsEstimate: true }),
      })],
    })
  })

  it('routes complete/backfill through immutable snapshots while persisting skip/delay and exact undo', async () => {
    const owner = await client()
    const supplement = await createCatalogItem(owner, 'supplement', 'Stocked supplement', 'capsule')
    const stock = await owner.write({
      method: 'POST', url: '/api/v1/life/inventory/transactions',
      payload: { itemId: supplement.id, kind: 'purchase', quantity: 10, unit: 'capsule', occurredAt: '2026-08-13T08:00:00.000Z' },
    }, 'stock-supplement')
    expect(stock.statusCode).toBe(201)
    const day = await createDay(owner, '2026-08-18', [
      {
        kind: 'supplement', title: 'Stocked supplement', mealSlotId: null, scheduledTime: '08:00',
        source: { type: 'catalog-item', id: supplement.id }, quantity: 1, unit: 'capsule', servings: null, durationMinutes: null,
      },
      customItem('Skip me'), customItem('Delay me'), customItem('Backfill me'),
    ])
    for (const [index, action, extra, status] of [
      [1, 'skip', {}, 'skipped'],
      [2, 'delay', { delayedUntil: '11:30' }, 'delayed'],
    ] as const) {
      const response = await owner.write({
        method: 'PATCH', url: `/api/v1/life/day-plans/2026-08-18/items/${day.items[index]!.id}`,
        payload: { entityVersion: 1, action, at: '2026-08-18T09:00:00.000Z', ...extra },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ status })
    }
    const bypassedBackfill = await owner.write({
      method: 'PATCH', url: `/api/v1/life/day-plans/2026-08-18/items/${day.items[3]!.id}`,
      payload: { entityVersion: 1, action: 'backfill', at: '2026-08-17T19:00:00.000Z' },
    })
    expect(bypassedBackfill.statusCode).toBe(409)
    expect(bypassedBackfill.json()).toMatchObject({ error: { code: 'COMPLETION_ROUTE_REQUIRED' } })
    const backfilled = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: day.date, dayPlanItemId: day.items[3]!.id, completedAt: '2026-08-17T19:00:00.000Z' },
    }, 'backfill-custom-through-ledger')
    expect(backfilled.statusCode).toBe(201)
    expect(backfilled.json()).toMatchObject({ kind: 'custom', completedAt: '2026-08-17T19:00:00.000Z' })

    const complete = (idempotencyKey = 'complete-supplement-retry') => owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: day.date, dayPlanItemId: day.items[0]!.id, completedAt: '2026-08-18T08:05:00.000Z' },
    }, idempotencyKey)
    const first = await complete()
    const replay = await complete()
    expect(first.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${supplement.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: supplement.id, onHand: 9 }),
    ])
    const completion = first.json<{ id: string }>()
    const undo = () => owner.write({ method: 'POST', url: `/api/v1/life/completions/${completion.id}/undo`, payload: {} }, 'undo-supplement-retry')
    const undone = await undo()
    expect(undone.statusCode).toBe(200)
    expect((await undo()).json()).toEqual(undone.json())
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${supplement.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: supplement.id, onHand: 10 }),
    ])
    const recompleted = await complete('recomplete-supplement-after-undo')
    expect(recompleted.statusCode).toBe(201)
    expect(recompleted.json<{ id: string }>().id).not.toBe(completion.id)
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${supplement.id}`)).json()).toEqual([
      expect.objectContaining({ itemId: supplement.id, onHand: 9 }),
    ])
    const secondUndo = await owner.write({ method: 'POST', url: `/api/v1/life/completions/${completion.id}/undo`, payload: {} }, 'undo-supplement-again')
    expect(secondUndo.statusCode).toBe(409)
    expect((await owner.get(`/api/v1/life/inventory/transactions?itemId=${supplement.id}`)).json()).toHaveLength(4)
  })
})
