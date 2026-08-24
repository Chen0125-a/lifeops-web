import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('life commerce routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    let sequence = 0
    const store = new MemoryLifeStore({
      createId: () => `commerce-route-${++sequence}`,
      now: () => '2026-08-14T09:00:00.000Z',
    })
    await store.createUser({
      account: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: await hashPassword('owner-safe-password'),
    })
    await store.createUser({
      account: 'other@example.com',
      displayName: 'Other',
      passwordHash: await hashPassword('other-safe-password'),
    })
    app = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3_600, secureCookies: false },
    })
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
          'idempotency-key': idempotencyKey,
        },
      }),
    }
  }

  async function createItem(subject: Client, name: string, priceMinor = 1_000, categoryId: string | null = null) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'supplement',
        name,
        baseUnit: 'each',
        availableUnits: ['each'],
        categoryId,
        pricePoints: [{
          amountMinor: priceMinor,
          currency: 'CNY',
          purchaseQuantity: 5,
          purchaseUnit: 'each',
          effectiveFrom: '2026-08-01',
        }],
      },
    }, `catalog-${name}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number }>()
  }

  async function createCategory(subject: Client, name: string) {
    const response = await subject.write({
      method: 'POST', url: '/api/v1/life/taxonomy/categories',
      payload: { name, parentId: null },
    }, `category-${name}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>()
  }

  async function createFormalItem(subject: Client, itemId: string, quantity: number, key: string) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/shopping/items',
      payload: {
        itemId,
        requestedQuantity: quantity,
        unit: 'each',
        neededOn: '2026-08-20',
        priority: 'normal',
        storeGroup: 'Daily needs',
      },
    }, key)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>()
  }

  async function purchase(
    subject: Client,
    shoppingItemId: string,
    itemId: string,
    quantity: number,
    amountMinor: number,
    key: string,
    purchasedAt = '2026-08-14T08:00:00.000Z',
    updateCurrentPrice = true,
  ) {
    return subject.write({
      method: 'POST',
      url: '/api/v1/life/purchases',
      payload: {
        purchasedAt,
        currency: 'CNY',
        storeName: 'Local market',
        items: [{ shoppingItemId, itemId, quantity, unit: 'each', amountMinor, updateCurrentPrice }],
      },
    }, key)
  }

  it('closes a partial purchase across purchase, stock, cash, price and formal-list facts exactly once', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Electrolyte')
    const formal = await createFormalItem(owner, item.id, 5, 'formal-electrolyte')

    const first = await purchase(owner, formal.id, item.id, 2, 600, 'purchase-electrolyte-two')
    const replay = await purchase(owner, formal.id, item.id, 2, 600, 'purchase-electrolyte-two')
    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({
      purchase: { totalAmountMinor: 600, currency: 'CNY' },
      items: [{ itemId: item.id, quantity: 2, unit: 'each', amountMinor: 600 }],
      cashExpenditure: { amountMinor: 600, sourceType: 'purchase' },
      shoppingItems: [{ id: formal.id, status: 'partial', purchasedQuantity: 2, remainingQuantity: 3 }],
      inventoryTransactions: [{ itemId: item.id, kind: 'purchase', quantity: 2 }],
    })

    const balances = await owner.get(`/api/v1/life/inventory/balances?itemId=${encodeURIComponent(item.id)}`)
    expect(balances.json()).toEqual([expect.objectContaining({ itemId: item.id, onHand: 2 })])
    const ledger = await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)
    expect(ledger.json()).toHaveLength(1)
    const shopping = await owner.get('/api/v1/life/shopping')
    expect(shopping.json()).toMatchObject({
      formalItems: [expect.objectContaining({ id: formal.id, status: 'partial', remainingQuantity: 3 })],
    })
    const catalog = await owner.get(`/api/v1/life/catalog/${encodeURIComponent(item.id)}`)
    expect(catalog.json<{ pricePoints: Array<{ amountMinor: number; purchaseQuantity: number; effectiveFrom: string }> }>().pricePoints)
      .toEqual(expect.arrayContaining([{ amountMinor: 600, purchaseQuantity: 2, effectiveFrom: '2026-08-14', currency: 'CNY', purchaseUnit: 'each', id: expect.any(String) }]))
  })

  it('refunds by linked reverse inventory and cash facts without deleting or double-reversing the purchase', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Protein bar')
    const formal = await createFormalItem(owner, item.id, 4, 'formal-protein-bar')
    const bought = await purchase(owner, formal.id, item.id, 4, 1_000, 'purchase-protein-bar')
    expect(bought.statusCode).toBe(201)
    const purchaseBody = bought.json<{ purchase: { id: string }; items: Array<{ id: string }> }>()

    const refundRequest = {
      method: 'POST' as const,
      url: `/api/v1/life/purchases/${encodeURIComponent(purchaseBody.purchase.id)}/refunds`,
      payload: {
        refundedAt: '2026-08-14T10:00:00.000Z',
        items: [{ purchaseItemId: purchaseBody.items[0]!.id, quantity: 1, amountMinor: 250 }],
        note: 'Returned unopened item',
      },
    }
    const first = await owner.write(refundRequest, 'refund-protein-bar-one')
    const replay = await owner.write(refundRequest, 'refund-protein-bar-one')
    expect(first.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({
      refund: { purchaseId: purchaseBody.purchase.id, totalAmountMinor: 250 },
      cashExpenditure: { amountMinor: -250, sourceType: 'refund' },
      inventoryTransactions: [{ itemId: item.id, kind: 'return', quantity: 1 }],
    })

    const balances = await owner.get(`/api/v1/life/inventory/balances?itemId=${encodeURIComponent(item.id)}`)
    expect(balances.json()).toEqual([expect.objectContaining({ onHand: 3 })])
    const ledger = await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)
    expect(ledger.json<Array<{ kind: string }>>().map((entry) => entry.kind)).toEqual(['return', 'purchase'])
    const analytics = await owner.get('/api/v1/life/analytics?from=2026-08-14&to=2026-08-14')
    expect(analytics.json()).toMatchObject({
      totals: { cashExpenditureMinor: 750 },
      drillDown: {
        cashExpenditure: expect.arrayContaining([
          expect.objectContaining({ sourceType: 'purchase', sourceId: purchaseBody.purchase.id, amountMinor: 1_000 }),
          expect.objectContaining({ sourceType: 'refund', amountMinor: -250 }),
        ]),
      },
    })
  })

  it('keeps cash expenditure and consumption cost separate while budgets expose thresholds and a forecast', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Daily supplement')
    const budget = await owner.write({
      method: 'POST',
      url: '/api/v1/life/budgets',
      payload: {
        name: 'August life budget',
        scope: { kind: 'all-life' },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 1_000,
        thresholds: [0.5, 0.8, 1],
        rolloverMinor: 0,
      },
    }, 'budget-august')
    expect(budget.statusCode).toBe(201)

    for (const [index, date, amount] of [
      [1, '2026-08-02T08:00:00.000Z', 300],
      [2, '2026-08-08T08:00:00.000Z', 300],
      [3, '2026-08-13T08:00:00.000Z', 0],
    ] as const) {
      const formal = await createFormalItem(owner, item.id, 1, `formal-budget-${index}`)
      expect((await purchase(owner, formal.id, item.id, 1, amount, `purchase-budget-${index}`, date, false)).statusCode).toBe(201)
    }

    const day = await owner.write({
      method: 'POST',
      url: '/api/v1/life/day-plans',
      payload: {
        date: '2026-08-13',
        mealSlots: [],
        items: [{
          kind: 'supplement',
          title: 'Daily supplement',
          mealSlotId: null,
          scheduledTime: '09:00',
          source: { type: 'catalog-item', id: item.id },
          quantity: 1,
          unit: 'each',
          servings: null,
          durationMinutes: null,
        }],
      },
    }, 'day-supplement')
    expect(day.statusCode).toBe(201)
    const dayBody = day.json<{ items: Array<{ id: string }> }>()
    const completion = await owner.write({
      method: 'POST',
      url: '/api/v1/life/completions',
      payload: {
        date: '2026-08-13',
        dayPlanItemId: dayBody.items[0]!.id,
        completedAt: '2026-08-13T09:05:00.000Z',
      },
    }, 'complete-budget-supplement')
    expect(completion.statusCode).toBe(201)

    const budgets = await owner.get('/api/v1/life/budgets?asOf=2026-08-14')
    expect(budgets.statusCode).toBe(200)
    expect(budgets.json()).toEqual([
      expect.objectContaining({
        id: budget.json<{ id: string }>().id,
        spentMinor: 600,
        remainingMinor: 400,
        thresholdStatus: 'warning',
        forecast: expect.objectContaining({ status: 'complete', projectedMinor: expect.any(Number) }),
      }),
    ])
    expect(budgets.json<Array<{ forecast: { projectedMinor: number } }>>()[0]!.forecast.projectedMinor).toBeGreaterThan(600)

    const analytics = await owner.get('/api/v1/life/analytics?from=2026-08-12&to=2026-08-13')
    expect(analytics.statusCode).toBe(200)
    expect(analytics.json()).toMatchObject({
      days: [
        {
          date: '2026-08-12',
          cashExpenditure: { status: 'no-record' },
          consumptionCost: { status: 'no-record' },
        },
        {
          date: '2026-08-13',
          cashExpenditure: { status: 'recorded', valueMinor: 0, sourceIds: [expect.any(String)] },
          consumptionCost: { status: 'recorded', valueMinor: 300, sourceIds: [completion.json<{ id: string }>().id] },
        },
      ],
      totals: { cashExpenditureMinor: 0, consumptionCostMinor: 300 },
    })
  })

  it('limits item, category and custom budgets to their explicit purchase and refund sources', async () => {
    const owner = await client()
    const category = await createCategory(owner, 'Scoped supplements')
    const included = await createItem(owner, 'Scoped included', 1_000, category.id)
    const excluded = await createItem(owner, 'Scoped excluded')
    const includedFormal = await createFormalItem(owner, included.id, 1, 'formal-scoped-included')
    const excludedFormal = await createFormalItem(owner, excluded.id, 1, 'formal-scoped-excluded')
    expect((await purchase(owner, includedFormal.id, included.id, 1, 300, 'purchase-scoped-included')).statusCode).toBe(201)
    expect((await purchase(owner, excludedFormal.id, excluded.id, 1, 700, 'purchase-scoped-excluded')).statusCode).toBe(201)

    for (const [name, scope] of [
      ['Included item only', { kind: 'item', itemIds: [included.id] }],
      ['Included category only', { kind: 'category', categoryIds: [category.id] }],
      ['Explicit union', { kind: 'custom', itemIds: [excluded.id], categoryIds: [category.id] }],
    ] as const) {
      const created = await owner.write({
        method: 'POST', url: '/api/v1/life/budgets',
        payload: {
          name, scope, period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
          limitMinor: 2_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
        },
      }, `budget-${name}`)
      expect(created.statusCode, created.body).toBe(201)
    }

    const summaries = await owner.get('/api/v1/life/budgets?asOf=2026-08-14')
    expect(summaries.statusCode).toBe(200)
    expect(summaries.json<Array<{ name: string; spentMinor: number }>>().map(({ name, spentMinor }) => ({ name, spentMinor }))).toEqual([
      { name: 'Included item only', spentMinor: 300 },
      { name: 'Included category only', spentMinor: 300 },
      { name: 'Explicit union', spentMinor: 1_000 },
    ])
  })

  it('rejects foreign or missing budget scope references before persisting a budget', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const foreignItem = await createItem(other, 'Foreign budget item')
    const foreignCategory = await createCategory(other, 'Foreign budget category')

    for (const [key, scope] of [
      ['foreign-item', { kind: 'item', itemIds: [foreignItem.id] }],
      ['foreign-category', { kind: 'category', categoryIds: [foreignCategory.id] }],
      ['missing-custom', { kind: 'custom', itemIds: ['missing-item'], categoryIds: ['missing-category'] }],
    ] as const) {
      const response = await owner.write({
        method: 'POST', url: '/api/v1/life/budgets', payload: {
          name: `Invalid ${key}`, scope,
          period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
          limitMinor: 1_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
        },
      }, `budget-${key}`)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }

    expect((await owner.get('/api/v1/life/budgets?asOf=2026-08-14')).json()).toEqual([])
  })

  it('rejects shopping reasons whose source type contradicts the reason kind', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Reason-bound item')
    const response = await owner.write({
      method: 'POST', url: '/api/v1/life/shopping/suggestions', payload: {
        itemId: item.id, requiredQuantity: 1, unit: 'each', packageQuantity: 1,
        reason: {
          kind: 'minimum_stock', sourceType: 'day-plan', sourceId: 'forged-plan', requiredOn: null,
        },
      },
    }, 'mismatched-shopping-reason')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_SHOPPING_REASON_SOURCE' } })
    expect((await owner.get('/api/v1/life/shopping')).json()).toEqual({ suggestions: [], formalItems: [] })
  })

  it('persists one owner-scoped versioned inventory policy with a compatible explicit unit', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const item = await createItem(owner, 'Policy-bound item')
    const url = `/api/v1/life/inventory-policies/${encodeURIComponent(item.id)}`

    const created = await owner.write({
      method: 'PUT', url, payload: { minimumStock: 0, packageQuantity: 5, unitId: 'builtin:each' },
    }, 'create-policy-bound-item')
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      itemId: item.id, minimumStock: 0, packageQuantity: 5,
      unitId: 'builtin:each', unit: 'each', version: 1,
    })

    const updated = await owner.write({
      method: 'PUT', url, payload: { minimumStock: 2, packageQuantity: 10, unitId: 'builtin:each', version: 1 },
    }, 'update-policy-bound-item')
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ minimumStock: 2, packageQuantity: 10, version: 2 })

    const stale = await owner.write({
      method: 'PUT', url, payload: { minimumStock: 3, packageQuantity: 10, unitId: 'builtin:each', version: 1 },
    }, 'stale-policy-bound-item')
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT', current: { version: 2, minimumStock: 2 } } })

    const incompatible = await owner.write({
      method: 'PUT', url, payload: { minimumStock: 2, packageQuantity: 10, unitId: 'builtin:gram', version: 2 },
    }, 'incompatible-policy-bound-item')
    expect(incompatible.statusCode).toBe(409)
    expect(incompatible.json()).toMatchObject({ error: { code: 'INCOMPATIBLE_POLICY_UNIT' } })

    expect((await owner.get('/api/v1/life/inventory-policies')).json()).toEqual([
      expect.objectContaining({ itemId: item.id, version: 2, unitId: 'builtin:each' }),
    ])
    expect((await other.get('/api/v1/life/inventory-policies')).json()).toEqual([])
    expect((await other.write({
      method: 'PUT', url, payload: { minimumStock: 1, packageQuantity: 1, unitId: 'builtin:each' },
    }, 'foreign-policy-bound-item')).statusCode).toBe(404)
  })

  it('returns traceable incomplete recalculation facts without writing an invented derived suggestion', async () => {
    const owner = await client()
    const catalog = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog', payload: {
        kind: 'supplement', name: 'Unconverted powder', baseUnit: 'gram', availableUnits: ['gram', 'scoop'],
      },
    }, 'unconverted-powder')
    expect(catalog.statusCode).toBe(201)
    const item = catalog.json<{ id: string }>()
    expect((await owner.write({
      method: 'PUT', url: `/api/v1/life/inventory-policies/${item.id}`,
      payload: { minimumStock: 100, packageQuantity: 250, unitId: 'builtin:gram' },
    }, 'unconverted-powder-policy')).statusCode).toBe(201)
    const day = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans', payload: {
        date: '2026-08-18', mealSlots: [], items: [{
          kind: 'supplement', title: 'Unconverted powder', mealSlotId: null, scheduledTime: '08:00',
          source: { type: 'catalog-item', id: item.id }, quantity: 1, unit: 'scoop',
          servings: null, durationMinutes: null,
        }],
      },
    }, 'unconverted-powder-day')
    expect(day.statusCode).toBe(201)
    const itemId = day.json<{ items: Array<{ id: string }> }>().items[0]!.id

    const recalculated = await owner.write({
      method: 'POST', url: '/api/v1/life/shopping/recalculate', payload: { through: '2026-08-18' },
    }, 'recalculate-unconverted-powder')
    expect(recalculated.statusCode).toBe(200)
    expect(recalculated.json()).toMatchObject({
      suggestions: [], calculations: [],
      incomplete: [{
        status: 'incomplete', itemId: item.id, unitId: 'builtin:gram', unit: 'gram',
        reason: 'missing_conversion', evidence: [{ sourceType: 'day-plan-item', sourceId: itemId, sourceQuantity: null, sourceUnit: null }],
      }],
    })
    expect((await owner.get('/api/v1/life/shopping')).json()).toEqual({ suggestions: [], formalItems: [] })
  })

  it('allocates a mixed purchase and refund to scoped budgets by matching line amount only', async () => {
    const owner = await client()
    const included = await createItem(owner, 'Mixed included')
    const excluded = await createItem(owner, 'Mixed excluded')
    const bought = await owner.write({
      method: 'POST', url: '/api/v1/life/purchases', payload: {
        purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY', storeName: 'Mixed store',
        items: [
          { itemId: included.id, quantity: 1, unit: 'each', amountMinor: 300 },
          { itemId: excluded.id, quantity: 1, unit: 'each', amountMinor: 700 },
        ],
      },
    }, 'mixed-scope-purchase')
    expect(bought.statusCode).toBe(201)
    const purchaseBody = bought.json<{ purchase: { id: string }; items: Array<{ id: string; itemId: string }> }>()
    const includedLine = purchaseBody.items.find((item) => item.itemId === included.id)!
    expect((await owner.write({
      method: 'POST', url: `/api/v1/life/purchases/${purchaseBody.purchase.id}/refunds`, payload: {
        refundedAt: '2026-08-14T10:00:00.000Z',
        items: [{ purchaseItemId: includedLine.id, quantity: 1, amountMinor: 100 }],
      },
    }, 'mixed-scope-refund')).statusCode).toBe(201)
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/budgets', payload: {
        name: 'Mixed included only', scope: { kind: 'item', itemIds: [included.id] },
        period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
        limitMinor: 1_000, thresholds: [0.5, 0.8, 1], rolloverMinor: 0,
      },
    }, 'mixed-scope-budget')).statusCode).toBe(201)

    const summaries = await owner.get('/api/v1/life/budgets?asOf=2026-08-14')
    expect(summaries.json()).toEqual([
      expect.objectContaining({ name: 'Mixed included only', spentMinor: 200, remainingMinor: 800 }),
    ])
  })

  it('converts purchase quantities into the formal-list unit before remainder checks and updates', async () => {
    const owner = await client()
    const catalog = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog', payload: {
        kind: 'ingredient', name: 'Bulk rice', baseUnit: 'gram', availableUnits: ['gram', 'kilogram'],
      },
    }, 'bulk-rice')
    expect(catalog.statusCode).toBe(201)
    const item = catalog.json<{ id: string }>()
    const formal = await owner.write({
      method: 'POST', url: '/api/v1/life/shopping/items', payload: {
        itemId: item.id, requestedQuantity: 1, unit: 'kilogram', neededOn: null,
        priority: 'normal', storeGroup: 'Bulk',
      },
    }, 'bulk-rice-formal')
    expect(formal.statusCode).toBe(201)
    const formalId = formal.json<{ id: string }>().id

    const first = await owner.write({
      method: 'POST', url: '/api/v1/life/purchases', payload: {
        purchasedAt: '2026-08-14T08:00:00.000Z', currency: 'CNY',
        items: [{ shoppingItemId: formalId, itemId: item.id, quantity: 500, unit: 'gram', amountMinor: 300 }],
      },
    }, 'bulk-rice-first')
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({
      shoppingItems: [{ id: formalId, purchasedQuantity: 0.5, remainingQuantity: 0.5, status: 'partial' }],
    })
    const second = await owner.write({
      method: 'POST', url: '/api/v1/life/purchases', payload: {
        purchasedAt: '2026-08-14T09:00:00.000Z', currency: 'CNY',
        items: [{ shoppingItemId: formalId, itemId: item.id, quantity: 0.5, unit: 'kilogram', amountMinor: 300 }],
      },
    }, 'bulk-rice-second')
    expect(second.statusCode).toBe(201)
    expect(second.json()).toMatchObject({
      shoppingItems: [{ id: formalId, purchasedQuantity: 1, remainingQuantity: 0, status: 'purchased' }],
    })
  })

  it('rejects duplicate refund lines atomically before they can over-return one purchase item', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Duplicate refund item')
    const formal = await createFormalItem(owner, item.id, 4, 'duplicate-refund-formal')
    const bought = await purchase(owner, formal.id, item.id, 4, 1_000, 'duplicate-refund-purchase')
    const body = bought.json<{ purchase: { id: string }; items: Array<{ id: string }> }>()
    const failed = await owner.write({
      method: 'POST', url: `/api/v1/life/purchases/${body.purchase.id}/refunds`, payload: {
        refundedAt: '2026-08-14T10:00:00.000Z', items: [
          { purchaseItemId: body.items[0]!.id, quantity: 3, amountMinor: 750 },
          { purchaseItemId: body.items[0]!.id, quantity: 3, amountMinor: 750 },
        ],
      },
    }, 'duplicate-refund-lines')
    expect(failed.statusCode).toBe(400)
    expect(failed.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    expect((await owner.get(`/api/v1/life/inventory/balances?itemId=${item.id}`)).json()).toEqual([
      expect.objectContaining({ onHand: 4 }),
    ])
    expect((await owner.get('/api/v1/life/analytics?from=2026-08-14&to=2026-08-14')).json()).toMatchObject({
      totals: { cashExpenditureMinor: 1_000 },
    })
  })

  it('distinguishes no plan, planned, actual and incomplete execution in analytics', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Analytics plan item', 0)
    const stocked = await createFormalItem(owner, item.id, 2, 'analytics-plan-stock-formal')
    expect((await purchase(owner, stocked.id, item.id, 2, 0, 'analytics-plan-stock')).statusCode).toBe(201)
    const day = await owner.write({
      method: 'POST', url: '/api/v1/life/day-plans', payload: {
        date: '2026-08-14', mealSlots: [], items: [
          { kind: 'supplement', title: 'Completed zero', mealSlotId: null, scheduledTime: '08:00', source: { type: 'catalog-item', id: item.id }, quantity: 1, unit: 'each', servings: null, durationMinutes: null },
          { kind: 'supplement', title: 'Still planned', mealSlotId: null, scheduledTime: '09:00', source: { type: 'catalog-item', id: item.id }, quantity: 1, unit: 'each', servings: null, durationMinutes: null },
        ],
      },
    }, 'analytics-plan-day')
    const items = day.json<{ items: Array<{ id: string }> }>().items
    const completed = await owner.write({
      method: 'POST', url: '/api/v1/life/completions', payload: {
        date: '2026-08-14', dayPlanItemId: items[0]!.id, completedAt: '2026-08-14T08:05:00.000Z',
      },
    }, 'analytics-plan-completion')
    expect(completed.statusCode).toBe(201)

    const analytics = await owner.get('/api/v1/life/analytics?from=2026-08-13&to=2026-08-14')
    expect(analytics.json()).toMatchObject({
      days: [
        { date: '2026-08-13', planExecution: { status: 'no-record' } },
        { date: '2026-08-14', planExecution: {
          status: 'recorded', plannedCount: 2, actualCount: 1, incompleteCount: 1,
          sourceIds: [items[0]!.id, items[1]!.id],
        } },
      ],
      totals: { plannedCount: 2, actualCount: 1, incompleteCount: 1 },
    })
  })

  it('requires authentication and preserves owner isolation for shopping, budgets and analytics', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/life/shopping' })).statusCode).toBe(401)
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const item = await createItem(owner, 'Private purchase')
    await createFormalItem(owner, item.id, 1, 'formal-private')
    expect((await other.get('/api/v1/life/shopping')).json()).toEqual({ suggestions: [], formalItems: [] })
    expect((await other.get('/api/v1/life/budgets?asOf=2026-08-14')).json()).toEqual([])
    expect((await other.get('/api/v1/life/analytics?from=2026-08-14&to=2026-08-14')).json()).toMatchObject({
      totals: { cashExpenditureMinor: 0, consumptionCostMinor: 0 },
    })
  })
})
