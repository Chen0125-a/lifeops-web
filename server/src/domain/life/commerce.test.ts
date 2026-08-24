import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { hashPassword } from '../../security/password.js'
import { MemoryLifeStore } from '../../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('life commerce shopping behavior', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    let sequence = 0
    const store = new MemoryLifeStore({
      createId: () => `commerce-domain-${++sequence}`,
      now: () => '2026-08-14T09:00:00.000Z',
    })
    await store.createUser({
      account: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: await hashPassword('owner-safe-password'),
    })
    app = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3_600, secureCookies: false },
    })
    await app.ready()
  })

  afterEach(async () => app.close())

  async function client(): Promise<Client> {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'owner@example.com', password: 'owner-safe-password' },
    })
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
          'idempotency-key': idempotencyKey,
        },
      }),
    }
  }

  async function createCountedItem(subject: Client) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'supplement',
        name: 'Dishwasher tablet',
        baseUnit: 'each',
        availableUnits: ['each', 'package'],
        itemConversions: [{ itemId: 'pending', fromUnit: 'package', toUnit: 'each', factor: 4 }],
      },
    }, 'catalog-dishwasher-tablet')
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>()
  }

  it('derives one traceable suggestion from policy, future demand, usable stock and formal outstanding quantity', async () => {
    const owner = await client()
    const item = await createCountedItem(owner)

    const forgedDerived = await owner.write({
      method: 'POST',
      url: '/api/v1/life/shopping/suggestions',
      payload: {
        itemId: item.id,
        requiredQuantity: 5,
        unit: 'each',
        packageQuantity: 4,
        reason: {
          kind: 'planned_shortage',
          sourceType: 'day-plan',
          sourceId: 'day-plan-2026-08-18',
          requiredOn: '2026-08-18',
        },
      },
    }, 'suggestion-planned-shortage')
    expect(forgedDerived.statusCode).toBe(400)
    expect(forgedDerived.json()).toMatchObject({ error: { code: 'DERIVED_SHOPPING_FACTS_SERVER_OWNED' } })

    const manual = await owner.write({
      method: 'POST',
      url: '/api/v1/life/shopping/suggestions',
      payload: {
        itemId: item.id,
        requiredQuantity: 3,
        unit: 'each',
        packageQuantity: 1,
        reason: {
          kind: 'manual',
          sourceType: 'manual',
          sourceId: 'weekend-cleaning',
          requiredOn: '2026-08-18',
        },
      },
    }, 'suggestion-manual')
    expect(manual.statusCode).toBe(201)
    expect(manual.json()).toMatchObject({ origin: 'manual', through: null })

    const policy = await owner.write({
      method: 'PUT',
      url: `/api/v1/life/inventory-policies/${encodeURIComponent(item.id)}`,
      payload: {
        minimumStock: 2,
        packageQuantity: 4,
        unitId: 'builtin:each',
      },
    }, 'policy-dishwasher-tablet')
    expect(policy.statusCode).toBe(201)
    expect(policy.json()).toMatchObject({
      itemId: item.id, minimumStock: 2, packageQuantity: 4,
      unitId: 'builtin:each', unit: 'each', version: 1,
    })

    const stock = await owner.write({
      method: 'POST', url: '/api/v1/life/inventory/transactions', payload: {
        itemId: item.id, kind: 'purchase', quantity: 1, unit: 'each',
        occurredAt: '2026-08-14T08:00:00.000Z', batch: { expiresOn: '2026-12-31' },
      },
    }, 'stock-dishwasher-tablet')
    expect(stock.statusCode).toBe(201)

    const day = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans', payload: {
        date: '2026-08-18', mealSlots: [], items: [{
          kind: 'supplement', title: 'Use dishwasher tablets', mealSlotId: null, scheduledTime: '20:00',
          source: { type: 'catalog-item', id: item.id }, quantity: 5, unit: 'each',
          servings: null, durationMinutes: null,
        }],
      },
    }, 'dishwasher-tablet-day')
    expect(day.statusCode).toBe(201)
    const dayItem = day.json<{ items: Array<{ id: string }> }>().items[0]!

    const formal = await owner.write({
      method: 'POST', url: '/api/v1/life/shopping/items', payload: {
        itemId: item.id, requestedQuantity: 1, unit: 'each', neededOn: '2026-08-18',
        priority: 'normal', storeGroup: 'Household',
      },
    }, 'dishwasher-tablet-formal-one')
    expect(formal.statusCode).toBe(201)
    const formalItem = formal.json<{ id: string }>()

    const request = { method: 'POST' as const, url: '/api/v1/life/shopping/recalculate', payload: { through: '2026-08-18' } }
    const recalculated = await owner.write(request, 'recalculate-dishwasher-tablet')
    const replay = await owner.write(request, 'recalculate-dishwasher-tablet')
    expect(recalculated.statusCode).toBe(200)
    expect(replay.json()).toEqual(recalculated.json())
    expect(recalculated.json()).toMatchObject({
      through: '2026-08-18',
      calculations: [{
        status: 'complete', itemId: item.id, policyVersion: 1,
        unitId: 'builtin:each', unit: 'each', plannedDemand: 5,
        minimumStock: 2, effectiveStock: 1, outstandingFormalQuantity: 1,
        packageQuantity: 4, rawShortage: 5, suggestedQuantity: 8,
        evidence: {
          planned: [{
            sourceType: 'day-plan-item', sourceId: dayItem.id, date: '2026-08-18',
            sourceQuantity: 5, sourceUnit: 'each', policyQuantity: 5, conversionFactor: 1,
          }],
          stock: [{ sourceType: 'inventory-batches', sourceQuantity: 1, sourceUnit: 'each', policyQuantity: 1, conversionFactor: 1 }],
          outstanding: [{
            sourceType: 'shopping-item', sourceId: formalItem.id,
            sourceQuantity: 1, sourceUnit: 'each', policyQuantity: 1, conversionFactor: 1,
          }],
        },
      }],
      incomplete: [],
      suggestions: [{
        origin: 'derived', through: '2026-08-18', itemId: item.id,
        requiredQuantity: 7, suggestedQuantity: 8, unit: 'each', packageQuantity: 4,
        reasons: [
          { kind: 'planned_shortage', sourceType: 'day-plan', sourceId: dayItem.id, requiredQuantity: 5 },
          { kind: 'minimum_stock', sourceType: 'inventory-policy', sourceId: expect.any(String), requiredQuantity: 2 },
        ],
      }],
    })

    const conflict = await owner.write(
      { ...request, payload: { through: '2026-08-19' } },
      'recalculate-dishwasher-tablet',
    )
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } })

    const shopping = await owner.get('/api/v1/life/shopping')
    expect(shopping.statusCode).toBe(200)
    expect(shopping.json()).toMatchObject({
      suggestions: expect.arrayContaining([
        expect.objectContaining({ origin: 'manual', itemId: item.id, reasons: [expect.objectContaining({ sourceId: 'weekend-cleaning' })] }),
        expect.objectContaining({ origin: 'derived', itemId: item.id, suggestedQuantity: 8 }),
      ]),
      formalItems: [expect.objectContaining({ id: formalItem.id, remainingQuantity: 1 })],
    })
  })

  it('keeps system suggestions separate from the formal list and subtracts already-requested quantity', async () => {
    const owner = await client()
    const item = await createCountedItem(owner)
    expect((await owner.write({
      method: 'POST',
      url: '/api/v1/life/shopping/suggestions',
      payload: {
        itemId: item.id,
        requiredQuantity: 7,
        unit: 'each',
        packageQuantity: 4,
        reason: { kind: 'manual', sourceType: 'manual', sourceId: 'temporary-need', requiredOn: '2026-08-18' },
      },
    }, 'suggestion-seven')).statusCode).toBe(201)

    const formal = await owner.write({
      method: 'POST',
      url: '/api/v1/life/shopping/items',
      payload: {
        itemId: item.id,
        requestedQuantity: 4,
        unit: 'each',
        neededOn: '2026-08-18',
        priority: 'normal',
        storeGroup: 'Household',
      },
    }, 'formal-four')
    expect(formal.statusCode).toBe(201)

    const shopping = await owner.get('/api/v1/life/shopping')
    expect(shopping.statusCode).toBe(200)
    const body = shopping.json<{
      suggestions: Array<{ id: string; kind: string; suggestedQuantity: number; reasons: unknown[] }>
      formalItems: Array<{ id: string; kind: string; requestedQuantity: number; remainingQuantity: number; status: string }>
    }>()
    expect(body.suggestions).toEqual([
      expect.objectContaining({ kind: 'suggestion', suggestedQuantity: 4, reasons: [expect.objectContaining({ sourceId: 'temporary-need' })] }),
    ])
    expect(body.formalItems).toEqual([
      expect.objectContaining({ kind: 'formal', requestedQuantity: 4, remainingQuantity: 4, status: 'added' }),
    ])
    expect(body.suggestions[0]!.id).not.toBe(body.formalItems[0]!.id)
  })

  it('keeps indivisible purchase cash exact while snapshotting fractional actual consumption cost', async () => {
    const owner = await client()
    const catalog = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog',
      payload: { kind: 'supplement', name: 'Three for one yuan', baseUnit: 'each', availableUnits: ['each'] },
    }, 'fractional-cost-item')
    expect(catalog.statusCode).toBe(201)
    const item = catalog.json<{ id: string }>()
    const purchase = await owner.write({
      method: 'POST', url: '/api/v1/life/purchases',
      payload: {
        purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY',
        items: [{ itemId: item.id, quantity: 3, unit: 'each', amountMinor: 100 }],
      },
    }, 'fractional-cost-purchase')
    expect(purchase.statusCode).toBe(201)
    expect(purchase.json()).toMatchObject({
      purchase: { totalAmountMinor: 100 }, cashExpenditure: { amountMinor: 100 },
    })
    const day = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans',
      payload: {
        date: '2026-08-14', mealSlots: [], items: [{
          kind: 'supplement', title: 'Use one', mealSlotId: null, scheduledTime: '09:00',
          source: { type: 'catalog-item', id: item.id }, quantity: 1, unit: 'each', servings: null, durationMinutes: null,
        }],
      },
    }, 'fractional-cost-day')
    expect(day.statusCode).toBe(201)
    const dayItem = day.json<{ items: Array<{ id: string }> }>().items[0]!
    const completion = await owner.write({
      method: 'POST', url: '/api/v1/life/completions',
      payload: { date: '2026-08-14', dayPlanItemId: dayItem.id, completedAt: '2026-08-14T09:00:00.000Z' },
    }, 'fractional-cost-completion')
    expect(completion.statusCode).toBe(201)
    expect(completion.json<{ costMinor: number }>().costMinor).toBeCloseTo(100 / 3, 8)

    const analytics = await owner.get('/api/v1/life/analytics?from=2026-08-14&to=2026-08-14')
    expect(analytics.statusCode).toBe(200)
    expect(analytics.json()).toMatchObject({
      totals: { cashExpenditureMinor: 100, consumptionCostMinor: expect.closeTo(100 / 3, 8) },
    })
  })
})
